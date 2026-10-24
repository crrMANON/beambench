/**
 * Read-only scene mirror for the interactive app.
 *
 * The upstream Three.js UI remains the renderer; this mirror holds a validated
 * SceneV1 snapshot with a monotonically increasing revision so host clients can
 * read state, observations and revision-matched captures. Mutating commands are
 * rejected until the UI is fully driven through CommandExecutor.
 */

import { SceneV1 } from '../domain/scene';
import { validateScene } from '../domain/scene-validation';
import { serializeScene } from '../domain/scene-io';
import { computeTrace, TraceElementInput } from '../physics/trace';
import { measure, MeasurementObservation } from '../physics/measurement';
import { CaptureView, CaptureResult } from '../render/capture';
import { Bb84OpticalModel, Bb84Runner } from '../qkd/bb84';
import type { CommandRequest, CommandResponse } from '../domain/commands';

export interface CaptureLike {
  capture(view: CaptureView, expectedRevision: number): Promise<CaptureResult>;
}

export interface SceneMirrorOptions {
  capture?: CaptureLike;
}

const READ_METHODS: ReadonlySet<string> = new Set([
  'get_state', 'observe', 'capture', 'save_scene', 'run_bb84',
]);

const DEFAULT_BB84_MODEL: Bb84OpticalModel = {
  transmission: 1,
  detectorEfficiency: 0.9,
  darkCountProbability: 0.001,
  misalignmentRad: 0.02,
};

const VIEWS: ReadonlySet<string> = new Set(['perspective', 'top', 'front', 'side']);
const MAX_CACHE = 16;

interface CachedResponse {
  fingerprint: string;
  response: CommandResponse;
}

export class SceneMirror {
  private scene: SceneV1;
  private revision: number;
  private capture?: CaptureLike;
  private cache = new Map<string, CachedResponse>();
  private bb84Runner = new Bb84Runner();

  constructor(initialScene: SceneV1, options: SceneMirrorOptions = {}) {
    const validation = validateScene(initialScene);
    if (!validation.valid) {
      throw new Error(`Invalid initial scene: ${validation.errors?.join('; ')}`);
    }
    this.scene = structuredClone(initialScene);
    this.revision = initialScene.revision;
    this.capture = options.capture;
  }

  getRevision(): number {
    return this.revision;
  }

  getScene(): SceneV1 {
    return structuredClone(this.scene);
  }

  setCapture(capture: CaptureLike | undefined): void {
    this.capture = capture;
  }

  /**
   * Adopt a new validated snapshot and advance the revision.
   * Invalid snapshots are rejected without replacing the previous state.
   */
  sync(next: SceneV1): number {
    const validation = validateScene(next);
    if (!validation.valid) {
      throw new Error(`Invalid scene snapshot: ${validation.errors?.join('; ')}`);
    }
    this.revision += 1;
    const snapshot = structuredClone(next);
    snapshot.revision = this.revision;
    this.scene = snapshot;
    return this.revision;
  }

  observe(): MeasurementObservation {
    const trace = computeTrace(this.scene as unknown as { revision: number; elements: TraceElementInput[] });
    return measure(trace, this.scene.elements as unknown as TraceElementInput[]);
  }

  async execute(req: CommandRequest): Promise<CommandResponse> {
    if (!req || req.protocolVersion !== 1 || typeof req.requestId !== 'string' ||
        req.requestId.length === 0) {
      return { requestId: req?.requestId ?? '', ok: false, error: 'VALIDATION' };
    }
    if (!READ_METHODS.has(req.method)) {
      return { requestId: req.requestId, ok: false, error: 'UNSUPPORTED' };
    }
    if (!Number.isInteger(req.expectedRevision) || req.expectedRevision !== this.revision) {
      return { requestId: req.requestId, ok: false, error: 'STALE_REVISION' };
    }

    const fingerprint = JSON.stringify(req.args ?? null);
    const cached = this.cache.get(req.requestId);
    if (cached) {
      return cached.fingerprint === fingerprint
        ? cached.response
        : { requestId: req.requestId, ok: false, error: 'VALIDATION' };
    }

    const response = await this.dispatch(req);
    if (this.cache.size >= MAX_CACHE && !this.cache.has(req.requestId)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(req.requestId, { fingerprint, response });
    return response;
  }

  private async dispatch(req: CommandRequest): Promise<CommandResponse> {
    switch (req.method) {
      case 'get_state':
        return { requestId: req.requestId, ok: true, revision: this.revision, result: this.getScene() };

      case 'observe':
        return { requestId: req.requestId, ok: true, revision: this.revision, result: this.observe() };

      case 'save_scene': {
        const json = serializeScene(this.scene);
        return {
          requestId: req.requestId,
          ok: true,
          revision: this.revision,
          result: { json, bytes: new TextEncoder().encode(json).byteLength },
        };
      }

      case 'run_bb84': {
        const args = req.args;
        const raw = args && typeof args === 'object'
          ? args as { pulses?: unknown; seed?: unknown; model?: unknown }
          : {};
        const pulses = raw.pulses ?? 10000;
        const seed = raw.seed ?? this.scene.seed;
        const model = (raw.model ?? DEFAULT_BB84_MODEL) as Bb84OpticalModel;

        if (!Number.isInteger(pulses) || (pulses as number) <= 0 ||
            (pulses as number) > 100000) {
          return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
        }

        try {
          const report = this.bb84Runner.run({
            pulses: pulses as number,
            seed: seed as number,
            model,
          });
          return {
            requestId: req.requestId,
            ok: true,
            revision: this.revision,
            result: { ...report, sceneRevision: this.revision },
          };
        } catch (err) {
          return {
            requestId: req.requestId,
            ok: false,
            error: 'VALIDATION',
            result: { message: (err as Error)?.message ?? String(err) },
          };
        }
      }

      case 'capture': {
        if (!this.capture) {
          return { requestId: req.requestId, ok: false, error: 'UNSUPPORTED' };
        }
        const args = req.args;
        const view = args && typeof args === 'object'
          ? (args as { view?: unknown }).view
          : undefined;
        if (typeof view !== 'string' || !VIEWS.has(view)) {
          return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
        }

        try {
          const frame = await this.capture.capture(view as CaptureView, req.expectedRevision);
          return { requestId: req.requestId, ok: true, revision: this.revision, result: frame };
        } catch (err) {
          const code = (err as { code?: string })?.code;
          return {
            requestId: req.requestId,
            ok: false,
            error: code === 'STALE_REVISION' || code === 'LIMIT' ? code : 'CAPTURE_FAILED',
            result: { message: (err as Error)?.message ?? String(err) },
          };
        }
      }

      default:
        return { requestId: req.requestId, ok: false, error: 'UNSUPPORTED' };
    }
  }
}
