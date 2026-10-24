/**
 * BB-03 Atomic Command Executor
 *
 * Implements command execution with optimistic concurrency control per PLAN §3.2:
 * - expectedRevision prevents lost updates
 * - Read-only methods never bump the revision
 * - Candidate state is validated before commit
 * - Failed commands never modify history or current state
 * - Bounded request cache makes retries idempotent; same id + different args is rejected
 * - Bounded serial execution (BUSY while a recompute is in flight)
 *
 * Error Codes: VALIDATION, STALE_REVISION, LIMIT, TRACE_FAILED, BUSY, UNSUPPORTED
 */

import { BaseElement, ElementKind, PositionTuple, SceneV1 } from './scene';
import { isValidPose, isValidUUID, validateScene } from './scene-validation';
import { SceneHistory, createEmptyScene, deserializeScene } from './scene-io';
import { computeTrace } from '../physics/trace';

export type CommandMethod =
  | 'add'
  | 'remove'
  | 'setPose'
  | 'setParam'
  | 'setDof'
  | 'execute'
  | 'load_scene'
  | 'reset'
  | 'undo'
  | 'redo'
  | 'get_state'
  | 'observe'
  | 'capture'
  | 'save_scene'
  | 'run_bb84';

export interface CommandRequest {
  protocolVersion: 1;
  requestId: string;
  expectedRevision: number;
  method: CommandMethod;
  args: unknown;
}

export interface CommandResponse {
  requestId: string;
  ok: boolean;
  revision?: number;
  result?: unknown;
  error?: string;
}

export interface DetectorObservation {
  uuid: string | undefined;
  power: number;
  position: PositionTuple;
}

export interface Observation {
  revision: number;
  detectors: DetectorObservation[];
  traceStatus: 'OK' | 'TRACE_FAILED';
  modelLimits: string[];
}

const READ_ONLY_METHODS: ReadonlySet<CommandMethod> = new Set(['get_state', 'observe']);
const VALID_METHODS: ReadonlySet<string> = new Set<CommandMethod>([
  'add', 'remove', 'setPose', 'setParam', 'setDof', 'execute', 'load_scene',
  'reset', 'undo', 'redo', 'get_state', 'observe',
]);

const MAX_REQUEST_CACHE = 16;

/** Thrown for caller-correctable argument problems; mapped to VALIDATION */
export class CommandValidationError extends Error {}

interface CachedResponse {
  argsFingerprint: string;
  response: CommandResponse;
}

/** Bounded idempotency cache keyed by requestId */
class RequestCache {
  private cache = new Map<string, CachedResponse>();

  set(id: string, args: unknown, response: CommandResponse): void {
    if (this.cache.size >= MAX_REQUEST_CACHE && !this.cache.has(id)) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(id, { argsFingerprint: fingerprint(args), response });
  }

  /** Returns the cached response, or null when id+args conflict, undefined for miss */
  lookup(id: string, args: unknown): CommandResponse | null | undefined {
    const entry = this.cache.get(id);
    if (!entry) return undefined;
    if (entry.argsFingerprint !== fingerprint(args)) return null;
    return entry.response;
  }

  clear(): void {
    this.cache.clear();
  }
}

function fingerprint(args: unknown): string {
  try {
    return JSON.stringify(args) ?? 'undefined';
  } catch {
    return String(args);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTuple3(value: unknown): value is PositionTuple {
  return Array.isArray(value) && value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isTuple4(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

const ELEMENT_KINDS: readonly ElementKind[] = [
  'source', 'raysSource', 'lens', 'thickLens', 'mirror',
  'polarizer', 'waveplate', 'faraday', 'pbs', 'bs',
  'iris', 'detector', 'beamDump', 'grating',
];

export class CommandExecutor {
  private scene: SceneV1;
  private history: SceneHistory;
  private requestCache = new RequestCache();
  private recomputeInProgress = false;

  constructor(initialScene?: SceneV1) {
    this.scene = initialScene ? structuredClone(initialScene) : createEmptyScene();
    this.history = new SceneHistory();
    this.history.push(this.scene);
  }

  getCurrentScene(): SceneV1 {
    return structuredClone(this.scene);
  }

  getRevision(): number {
    return this.scene.revision;
  }

  async execute(req: CommandRequest): Promise<CommandResponse> {
    // Reject malformed envelopes before touching state.
    if (!req || req.protocolVersion !== 1) {
      return {
        requestId: typeof req?.requestId === 'string' ? req.requestId : '',
        ok: false,
        error: 'VALIDATION',
      };
    }

    if (typeof req.requestId !== 'string' || req.requestId.length === 0) {
      return { requestId: '', ok: false, error: 'VALIDATION' };
    }

    if (!VALID_METHODS.has(req.method)) {
      return { requestId: req.requestId, ok: false, error: 'UNSUPPORTED' };
    }

    // Idempotency: identical retries return the original response.
    // Same requestId with different arguments is rejected.
    const cached = this.requestCache.lookup(req.requestId, req.args);
    if (cached === null) {
      return { requestId: req.requestId, ok: false, error: 'VALIDATION' };
    }
    if (cached) {
      return cached;
    }

    // Optimistic concurrency check (applies to reads too).
    if (req.expectedRevision !== this.scene.revision) {
      return this.respond(req, { ok: false, error: 'STALE_REVISION' });
    }

    if (this.recomputeInProgress && !READ_ONLY_METHODS.has(req.method)) {
      return this.respond(req, { ok: false, error: 'BUSY' });
    }

    try {
      const response = await this.dispatch(req);
      return this.respond(req, response);
    } catch (err) {
      if (err instanceof CommandValidationError) {
        return this.respond(req, { ok: false, error: 'VALIDATION' });
      }
      return this.respond(req, {
        ok: false,
        error: 'TRACE_FAILED',
        result: { message: (err as Error)?.message ?? String(err) },
      });
    }
  }

  private respond(
    req: CommandRequest,
    partial: Omit<CommandResponse, 'requestId'>
  ): CommandResponse {
    const response: CommandResponse = { requestId: req.requestId, ...partial };
    this.requestCache.set(req.requestId, req.args, response);
    return response;
  }

  private async dispatch(req: CommandRequest): Promise<Omit<CommandResponse, 'requestId'>> {
    switch (req.method) {
      case 'get_state':
        return {
          ok: true,
          revision: this.scene.revision,
          result: structuredClone(this.scene),
        };

      case 'observe':
        return {
          ok: true,
          revision: this.scene.revision,
          result: this.buildObservation(),
        };

      case 'execute':
        return this.recompute();
    }

    // Mutations operate on a deep copy; validation happens before commit.
    let candidate: SceneV1;
    let result: unknown;

    switch (req.method) {
      case 'add':
        candidate = this.applyAdd(req.args);
        result = { uuid: candidate.elements[candidate.elements.length - 1].uuid };
        break;
      case 'remove':
        candidate = this.applyRemove(req.args);
        break;
      case 'setPose':
        candidate = this.applySetPose(req.args);
        break;
      case 'setParam':
        candidate = this.applySetParam(req.args);
        break;
      case 'setDof':
        candidate = this.applySetDof(req.args);
        break;
      case 'reset':
        candidate = this.applyReset(req.args);
        break;
      case 'load_scene': {
        const loaded = this.applyLoadScene(req.args);
        candidate = loaded;
        break;
      }
      case 'undo': {
        const previous = this.history.undo();
        if (!previous) return { ok: false, error: 'LIMIT' };
        candidate = previous;
        break;
      }
      case 'redo': {
        const next = this.history.redo();
        if (!next) return { ok: false, error: 'LIMIT' };
        candidate = next;
        break;
      }
      default:
        return { ok: false, error: 'UNSUPPORTED' };
    }

    const validation = validateScene(candidate);
    if (!validation.valid) {
      throw new CommandValidationError(validation.errors?.join('; '));
    }

    const isUndoRedo = req.method === 'undo' || req.method === 'redo';
    // Undo/redo restore an existing snapshot but still advance the revision so
    // external expectRevision holders cannot silently reuse an old version.
    candidate.revision = this.scene.revision + 1;

    if (!isUndoRedo) {
      this.scene = candidate;
      this.history.push(this.scene);
    } else {
      this.scene = candidate;
    }

    return { ok: true, revision: candidate.revision, result };
  }

  private recompute(): Omit<CommandResponse, 'requestId'> {
    this.recomputeInProgress = true;
    try {
      const trace = computeTrace(this.scene);
      return {
        ok: true,
        revision: this.scene.revision,
        result: {
          status: trace.summary.energyConserved ? 'OK' : 'ENERGY_UNCONSERVED',
          summary: trace.summary,
          warnings: trace.warnings,
        },
      };
    } finally {
      this.recomputeInProgress = false;
    }
  }

  private buildObservation(): Observation {
    const trace = computeTrace(this.scene);
    return {
      revision: this.scene.revision,
      detectors: trace.arrivals
        .filter((a) => a.destinationType === 'detector')
        .map((a) => ({
          uuid: a.destinationId,
          power: a.incidentPower,
          position: a.position,
        })),
      traceStatus: 'OK',
      modelLimits: trace.warnings.map((w) => w.message),
    };
  }

  // === Mutation helpers (all operate on a copy) ===

  private applyAdd(args: unknown): SceneV1 {
    if (!isRecord(args)) throw new CommandValidationError('add requires an object');

    const { kind, pose, mount, props, active = true, name } = args;

    if (typeof kind !== 'string' || !ELEMENT_KINDS.includes(kind as ElementKind)) {
      throw new CommandValidationError(`Unknown element kind: ${String(kind)}`);
    }
    if (!isRecord(pose) || !isTuple3(pose.position) || !isTuple4(pose.orientation)) {
      throw new CommandValidationError('Invalid pose');
    }
    if (!isRecord(mount) || !isTuple3(mount.pivotPoint) || !isRecord(mount.axes)) {
      throw new CommandValidationError('Invalid mount');
    }

    const element: BaseElement = {
      uuid: crypto.randomUUID(),
      kind: kind as ElementKind,
      name: typeof name === 'string' ? name : undefined,
      active: Boolean(active),
      pose: {
        position: [...pose.position] as PositionTuple,
        orientation: [...pose.orientation] as [number, number, number, number],
      },
      mount: structuredClone(mount) as BaseElement['mount'],
      props: isRecord(props) ? { ...props } : {},
    };

    return { ...this.scene, elements: [...this.scene.elements, element] };
  }

  private requireElement(uuid: unknown): BaseElement {
    if (typeof uuid !== 'string' || !isValidUUID(uuid)) {
      throw new CommandValidationError('Invalid element UUID');
    }
    const element = this.scene.elements.find((el) => el.uuid === uuid);
    if (!element) throw new CommandValidationError(`Unknown element UUID: ${uuid}`);
    return element;
  }

  private mapElement(uuid: unknown, update: (el: BaseElement) => BaseElement): SceneV1 {
    this.requireElement(uuid);
    return {
      ...this.scene,
      elements: this.scene.elements.map((el) => (el.uuid === uuid ? update(el) : el)),
    };
  }

  private applyRemove(args: unknown): SceneV1 {
    if (!isRecord(args)) throw new CommandValidationError('remove requires an object');
    this.requireElement(args.uuid);
    return {
      ...this.scene,
      elements: this.scene.elements.filter((el) => el.uuid !== args.uuid),
    };
  }

  private applySetPose(args: unknown): SceneV1 {
    if (!isRecord(args)) throw new CommandValidationError('setPose requires an object');
    const { uuid, pose } = args;
    const position = isRecord(pose) ? pose.position : undefined;
    const orientation = isRecord(pose) ? pose.orientation : undefined;
    if (!isTuple3(position) || !isTuple4(orientation) ||
        !isValidPose({ position, orientation })) {
      throw new CommandValidationError('Invalid pose');
    }
    return this.mapElement(uuid, (el) => ({
      ...el,
      pose: {
        position: [...position] as PositionTuple,
        orientation: [...orientation] as [number, number, number, number],
      },
    }));
  }

  private applySetParam(args: unknown): SceneV1 {
    if (!isRecord(args)) throw new CommandValidationError('setParam requires an object');
    const { uuid, param, value } = args;
    const element = this.requireElement(uuid);
    if (typeof param !== 'string' || !(param in element.props)) {
      throw new CommandValidationError(`Unknown parameter: ${String(param)}`);
    }
    return this.mapElement(uuid, (el) => ({
      ...el,
      props: { ...el.props, [param]: value },
    }));
  }

  private applySetDof(args: unknown): SceneV1 {
    if (!isRecord(args)) throw new CommandValidationError('setDof requires an object');
    const { uuid, axis, value } = args;
    if (axis !== 'tiltX' && axis !== 'tiltY' && axis !== 'rotationZ') {
      throw new CommandValidationError(`Unknown DOF axis: ${String(axis)}`);
    }
    if (!Array.isArray(value) || value.length !== 2 ||
        !value.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
        value[0] > value[1]) {
      throw new CommandValidationError('DOF value must be a finite [min,max] pair');
    }
    this.requireElement(uuid);
    return this.mapElement(uuid, (el) => ({
      ...el,
      mount: {
        ...el.mount,
        axes: {
          ...el.mount.axes,
          [axis]: { min: value[0], max: value[1] },
        },
      },
    }));
  }

  private applyReset(args: unknown): SceneV1 {
    const opts = isRecord(args) ? args : {};
    const scenario = isRecord(opts.scenario) ? opts.scenario : undefined;
    const rawSeed = opts.seed;

    if (rawSeed !== undefined && (!Number.isInteger(rawSeed) || !Number.isFinite(rawSeed))) {
      throw new CommandValidationError('seed must be an integer');
    }

    return createEmptyScene(
      scenario
        ? {
            width: typeof scenario.width === 'number' ? scenario.width : undefined,
            depth: typeof scenario.depth === 'number' ? scenario.depth : undefined,
            cellSize: typeof scenario.cellSize === 'number' ? scenario.cellSize : undefined,
          }
        : undefined,
      typeof rawSeed === 'number' ? rawSeed : undefined
    );
  }

  private applyLoadScene(args: unknown): SceneV1 {
    const json = typeof args === 'string'
      ? args
      : isRecord(args) && typeof args.json === 'string'
        ? args.json
        : null;
    if (json === null) throw new CommandValidationError('load_scene requires JSON text');

    const result = deserializeScene(json);
    if (!result.valid || !result.scene) {
      throw new CommandValidationError(result.errors?.join('; ') ?? 'Invalid scene');
    }
    return result.scene;
  }
}
