/**
 * UI command executor: mutating host commands applied to the live Three.js app.
 *
 * The UI adapter owns object creation/removal; this layer owns command
 * validation, optimistic concurrency, idempotency and revision advancement.
 * After every successful mutation it re-snapshots the UI and advances the
 * read-path revision, so get_state/observe/capture see the same state.
 */

import {
  ElementKind,
  PositionTuple,
  QuaternionTuple,
  SceneV1,
} from '../domain/scene';
import { isValidPose } from '../domain/scene-validation';
import { createEmptyScene, deserializeScene } from '../domain/scene-io';
import type { CommandRequest, CommandResponse } from '../domain/commands';
import { CaptureLike, SceneMirror } from './scene-mirror';

export interface UiPose {
  position: PositionTuple;
  orientation: QuaternionTuple;
}

export interface UiActions {
  /** Create an element; must return the UUID registered for the new object. */
  addElement(
    kind: ElementKind,
    pose: UiPose,
    props: Record<string, unknown>,
    name?: string
  ): { uuid: string };
  removeElement(uuid: string): boolean;
  setPose(uuid: string, pose: UiPose): boolean;
  setParam(uuid: string, param: string, value: unknown): boolean;
  /** Current UI state mapped to a validated SceneV1. */
  snapshot(): SceneV1;
  setDof?(uuid: string, axis: 'tiltX' | 'tiltY' | 'rotationZ', min: number, max: number): boolean;
  loadScene?(scene: SceneV1): boolean;
  /** Optional hooks used to suppress revision sync while a write is applied. */
  beforeMutation?(): void;
  afterMutation?(): void;
  undo?(): boolean;
  redo?(): boolean;
}

const ELEMENT_KINDS: ReadonlySet<string> = new Set<ElementKind>([
  'source', 'raysSource', 'lens', 'thickLens', 'mirror', 'polarizer',
  'waveplate', 'faraday', 'pbs', 'bs', 'iris', 'detector', 'beamDump', 'grating',
]);

const READ_METHODS: ReadonlySet<string> = new Set([
  'get_state', 'observe', 'capture', 'save_scene', 'run_bb84',
]);
const WRITE_METHODS: ReadonlySet<string> = new Set([
  'add', 'remove', 'setPose', 'setParam', 'setDof', 'load_scene', 'reset', 'undo', 'redo',
]);

function isTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function readPose(value: unknown): UiPose | null {
  if (!value || typeof value !== 'object') return null;
  const pose = value as { position?: unknown; orientation?: unknown };
  if (!isTuple(pose.position, 3) || !isTuple(pose.orientation, 4)) return null;
  const candidate: UiPose = {
    position: [...pose.position] as PositionTuple,
    orientation: [...pose.orientation] as QuaternionTuple,
  };
  return isValidPose(candidate) ? candidate : null;
}

export interface UiCommandExecutorOptions {
  actions: UiActions;
  initialScene: SceneV1;
  capture?: CaptureLike;
}

export class UiCommandExecutor {
  private actions: UiActions;
  private mirror: SceneMirror;
  private cache = new Map<string, { fingerprint: string; response: CommandResponse }>();
  private maxCache = 16;

  constructor(options: UiCommandExecutorOptions) {
    this.actions = options.actions;
    this.mirror = new SceneMirror(options.initialScene, { capture: options.capture });
  }

  getRevision(): number {
    return this.mirror.getRevision();
  }

  getScene(): SceneV1 {
    return this.mirror.getScene();
  }

  observe() {
    return this.mirror.observe();
  }

  setCapture(capture: CaptureLike | undefined): void {
    this.mirror.setCapture(capture);
  }

  sync(scene: SceneV1): number {
    return this.mirror.sync(scene);
  }

  async execute(req: CommandRequest): Promise<CommandResponse> {
    if (!req || req.protocolVersion !== 1 || typeof req.requestId !== 'string' ||
        req.requestId.length === 0) {
      return { requestId: req?.requestId ?? '', ok: false, error: 'VALIDATION' };
    }

    const isRead = READ_METHODS.has(req.method);
    if (!isRead && !WRITE_METHODS.has(req.method)) {
      return { requestId: req.requestId, ok: false, error: 'UNSUPPORTED' };
    }
    if (!Number.isInteger(req.expectedRevision) || req.expectedRevision !== this.getRevision()) {
      return { requestId: req.requestId, ok: false, error: 'STALE_REVISION' };
    }

    if (isRead) return this.mirror.execute(req);

    const fingerprint = JSON.stringify(req.args ?? null);
    const cached = this.cache.get(req.requestId);
    if (cached) {
      return cached.fingerprint === fingerprint
        ? cached.response
        : { requestId: req.requestId, ok: false, error: 'VALIDATION' };
    }

    const response = this.applyWrite(req);
    if (this.cache.size >= this.maxCache && !this.cache.has(req.requestId)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(req.requestId, { fingerprint, response });
    return response;
  }

  private applyWrite(req: CommandRequest): CommandResponse {
    const args = req.args;
    this.actions.beforeMutation?.();
    try {
      switch (req.method) {
        case 'add': {
          if (!args || typeof args !== 'object') {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          const raw = args as {
            kind?: unknown;
            pose?: unknown;
            props?: unknown;
            name?: unknown;
          };
          if (typeof raw.kind !== 'string' || !ELEMENT_KINDS.has(raw.kind)) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          const pose = readPose(raw.pose);
          if (!pose) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          const props = raw.props && typeof raw.props === 'object'
            ? (raw.props as Record<string, unknown>)
            : {};
          const name = typeof raw.name === 'string' ? raw.name : undefined;

          const created = this.actions.addElement(raw.kind as ElementKind, pose, props, name);
          const revision = this.mirror.sync(this.actions.snapshot());
          return {
            requestId: req.requestId,
            ok: true,
            revision,
            result: { uuid: created.uuid },
          };
        }

        case 'remove': {
          const uuid = this.readUuid(args);
          if (!uuid) return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          if (!this.actions.removeElement(uuid)) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          return {
            requestId: req.requestId,
            ok: true,
            revision: this.mirror.sync(this.actions.snapshot()),
          };
        }

        case 'setPose': {
          const uuid = this.readUuid(args);
          const pose = args && typeof args === 'object'
            ? readPose((args as { pose?: unknown }).pose)
            : null;
          if (!uuid || !pose) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          if (!this.actions.setPose(uuid, pose)) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          return {
            requestId: req.requestId,
            ok: true,
            revision: this.mirror.sync(this.actions.snapshot()),
          };
        }

        case 'setParam': {
          const uuid = this.readUuid(args);
          if (!uuid || !args || typeof args !== 'object') {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          const { param, value } = args as { param?: unknown; value?: unknown };
          if (typeof param !== 'string' || param.length === 0) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          if (!this.actions.setParam(uuid, param, value)) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          return {
            requestId: req.requestId,
            ok: true,
            revision: this.mirror.sync(this.actions.snapshot()),
          };
        }

        case 'setDof': {
          const uuid = this.readUuid(args);
          const raw = args && typeof args === 'object'
            ? args as { axis?: unknown; value?: unknown }
            : {};
          if (!uuid || !this.actions.setDof || !Array.isArray(raw.value) ||
              raw.value.length !== 2 ||
              !raw.value.every((item) => typeof item === 'number' && Number.isFinite(item)) ||
              raw.value[0] > raw.value[1] ||
              (raw.axis !== 'tiltX' && raw.axis !== 'tiltY' && raw.axis !== 'rotationZ')) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          if (!this.actions.setDof(uuid, raw.axis, raw.value[0], raw.value[1])) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          return {
            requestId: req.requestId,
            ok: true,
            revision: this.mirror.sync(this.actions.snapshot()),
          };
        }

        case 'load_scene': {
          if (!this.actions.loadScene) {
            return { requestId: req.requestId, ok: false, error: 'UNSUPPORTED' };
          }
          const json = typeof args === 'string'
            ? args
            : args && typeof args === 'object' && typeof (args as { json?: unknown }).json === 'string'
              ? (args as { json: string }).json
              : null;
          if (json === null) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          const result = deserializeScene(json);
          if (!result.valid || !result.scene) {
            return {
              requestId: req.requestId,
              ok: false,
              error: 'VALIDATION',
              result: { message: result.errors?.join('; ') ?? 'Invalid scene' },
            };
          }
          if (!this.actions.loadScene(result.scene)) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          return {
            requestId: req.requestId,
            ok: true,
            revision: this.mirror.sync(this.actions.snapshot()),
            result: { elements: result.scene.elements.length },
          };
        }

        case 'reset': {
          if (!this.actions.loadScene) {
            return { requestId: req.requestId, ok: false, error: 'UNSUPPORTED' };
          }
          const raw = args && typeof args === 'object'
            ? args as { seed?: unknown }
            : {};
          if (raw.seed !== undefined && (!Number.isInteger(raw.seed) || !Number.isFinite(raw.seed))) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          const empty = createEmptyScene(undefined, raw.seed as number | undefined);
          if (!this.actions.loadScene(empty)) {
            return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
          }
          return {
            requestId: req.requestId,
            ok: true,
            revision: this.mirror.sync(this.actions.snapshot()),
            result: { seed: empty.seed },
          };
        }

        case 'undo':
        case 'redo': {
          const action = req.method === 'undo' ? this.actions.undo : this.actions.redo;
          if (!action || !action.call(this.actions)) {
            return { requestId: req.requestId, ok: false, error: 'LIMIT' };
          }
          return {
            requestId: req.requestId,
            ok: true,
            revision: this.mirror.sync(this.actions.snapshot()),
          };
        }

        default:
          return { requestId: req.requestId, ok: false, error: 'UNSUPPORTED' };
      }
    } catch (err) {
      return {
        requestId: req.requestId,
        ok: false,
        error: 'VALIDATION',
        result: { message: (err as Error)?.message ?? String(err) },
      };
    } finally {
      this.actions.afterMutation?.();
    }
  }

  private readUuid(args: unknown): string | null {
    if (!args || typeof args !== 'object') return null;
    const uuid = (args as { uuid?: unknown }).uuid;
    return typeof uuid === 'string' && uuid.length > 0 ? uuid : null;
  }
}
