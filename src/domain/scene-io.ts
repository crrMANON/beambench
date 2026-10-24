/**
 * Scene I/O - JSON Import/Export for SceneV1
 *
 * Per PLAN §3.1 & BB-02 requirements:
 * - Validate BEFORE applying (never load untrusted data directly)
 * - Support legacy format migration
 * - Handle duplicate UUID errors gracefully (don't corrupt current scene)
 * - Roundtrip must preserve all fields including optical parameters
 * - Undo/redo support: maintain history stack
 */

import {
  BaseElement,
  ElementKind,
  PositionTuple,
  QuaternionTuple,
  SceneV1,
} from './scene';
import { ValidationResult, validateScene, createEmptyScene } from './scene-validation';

/** Supported schema versions */
type SchemaVersion = 1;

/** Optional metadata for saved scenes */
interface SceneMetadata {
  title?: string;
  description?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Complete scene file format with metadata (positions are tuples on the wire) */
export interface SceneFile {
  version: SchemaVersion;
  sceneId: string;
  revision: number;
  seed: number;
  table: { width: number; depth: number; cellSize: number };
  elements: {
    uuid: string;
    kind: ElementKind;
    name?: string;
    active: boolean;
    pose: {
      position: PositionTuple;
      orientation: QuaternionTuple;
    };
    mount: {
      pivotPoint: PositionTuple;
      axes: {
        tiltX: { min: number; max: number };
        tiltY: { min: number; max: number };
        rotationZ: { min: number; max: number };
      };
    };
    props: Record<string, unknown>;
  }[];
  camera: {
    position: PositionTuple;
    target: PositionTuple;
    fov: number;
  };
  meta?: SceneMetadata;
}

/** Result of deserialization: validation status plus the rebuilt scene */
export interface DeserializeResult extends ValidationResult {
  scene?: SceneV1;
}

/** Export scene to JSON string */
export function serializeScene(scene: SceneV1): string {
  const serialized: SceneFile = {
    version: 1,
    sceneId: scene.sceneId,
    revision: scene.revision,
    seed: scene.seed,
    table: { ...scene.table },
    elements: scene.elements.map((el) => ({
      uuid: el.uuid,
      kind: el.kind,
      name: el.name,
      active: el.active,
      pose: {
        position: [...el.pose.position] as PositionTuple,
        orientation: [...el.pose.orientation] as QuaternionTuple,
      },
      mount: {
        pivotPoint: [...el.mount.pivotPoint] as PositionTuple,
        axes: {
          tiltX: { ...el.mount.axes.tiltX },
          tiltY: { ...el.mount.axes.tiltY },
          rotationZ: { ...el.mount.axes.rotationZ },
        },
      },
      props: { ...el.props },
    })),
    camera: {
      position: [...scene.camera.position] as PositionTuple,
      target: [...scene.camera.target] as PositionTuple,
      fov: scene.camera.fov,
    },
    meta: scene.meta ? { ...scene.meta } : undefined,
  };

  return JSON.stringify(serialized, null, 2);
}

/** Check that a value is a length-3 numeric tuple */
function isTuple3(v: unknown): v is PositionTuple {
  return Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Check that a value is a length-4 numeric tuple */
function isTuple4(v: unknown): v is QuaternionTuple {
  return Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Parse and validate scene from JSON string */
export function deserializeScene(json: string): DeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      valid: false,
      errors: [`JSON parse error: ${(err as Error).message}`],
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false, errors: ['Must be a JSON object'] };
  }

  const file = parsed as Partial<SceneFile>;

  if (!Number.isInteger(file.version)) {
    return { valid: false, errors: [`Invalid version: ${String(file.version)}`] };
  }

  if (file.version !== 1) {
    // Unknown versions are rejected; legacy importers must be explicit.
    return {
      valid: false,
      errors: [`Unsupported schema version: ${file.version}. Use version 1.`],
    };
  }

  if (!Array.isArray(file.elements)) {
    return { valid: false, errors: ['Elements must be an array'] };
  }

  const elements: BaseElement[] = [];
  for (let i = 0; i < file.elements.length; i++) {
    const el = file.elements[i] as Partial<SceneFile['elements'][number]>;
    if (!el || typeof el.uuid !== 'string' || typeof el.kind !== 'string') {
      return { valid: false, errors: [`Element at index ${i} is malformed`] };
    }

    const pose = el.pose as Partial<{ position: unknown; orientation: unknown }> | undefined;
    const mount = el.mount as Partial<{
      pivotPoint: unknown;
      axes: { tiltX?: unknown; tiltY?: unknown; rotationZ?: unknown };
    }> | undefined;

    if (!pose || !isTuple3(pose.position) || !isTuple4(pose.orientation)) {
      return { valid: false, errors: [`Element at index ${i} has an invalid pose`] };
    }

    if (!mount || !isTuple3(mount.pivotPoint) || !mount.axes) {
      return { valid: false, errors: [`Element at index ${i} has an invalid mount`] };
    }

    const { tiltX, tiltY, rotationZ } = mount.axes;
    if (!tiltX || !tiltY || !rotationZ) {
      return { valid: false, errors: [`Element at index ${i} has incomplete DOF axes`] };
    }

    elements.push({
      uuid: el.uuid,
      kind: el.kind as ElementKind,
      name: el.name,
      active: Boolean(el.active),
      pose: {
        position: [...pose.position] as PositionTuple,
        orientation: [...pose.orientation] as QuaternionTuple,
      },
      mount: {
        pivotPoint: [...mount.pivotPoint] as PositionTuple,
        axes: {
          tiltX: { ...(tiltX as { min: number; max: number }) },
          tiltY: { ...(tiltY as { min: number; max: number }) },
          rotationZ: { ...(rotationZ as { min: number; max: number }) },
        },
      },
      props: (el.props as Record<string, unknown>) ?? {},
    });
  }

  const camera = file.camera as Partial<SceneFile['camera']> | undefined;
  if (!camera || !isTuple3(camera.position) || !isTuple3(camera.target) ||
      typeof camera.fov !== 'number') {
    return { valid: false, errors: ['Invalid camera/view parameters'] };
  }

  const scene: SceneV1 = {
    schemaVersion: 1,
    sceneId: typeof file.sceneId === 'string' ? file.sceneId : '',
    revision: typeof file.revision === 'number' ? file.revision : 0,
    seed: typeof file.seed === 'number' ? file.seed : 0,
    table: file.table as SceneV1['table'],
    elements,
    camera: {
      position: [...camera.position] as PositionTuple,
      target: [...camera.target] as PositionTuple,
      fov: camera.fov,
    },
    meta: file.meta ? { ...file.meta } : undefined,
  };

  const result = validateScene(scene);
  if (!result.valid) {
    return result;
  }

  return { ...result, scene };
}

/** Load scene from JSON string, returns updated scene or keeps original on error */
export function loadScene(
  currentScene: SceneV1,
  json: string,
  replaceCurrent: boolean = true
): { success: boolean; scene?: SceneV1; error?: string } {
  const result = deserializeScene(json);

  if (!result.valid || !result.scene) {
    return { success: false, error: result.errors?.join('; ') || 'Unknown error' };
  }

  if (replaceCurrent) {
    return { success: true, scene: result.scene };
  }

  // Merge: keep the live revision so a file load does not rewind concurrency.
  return {
    success: true,
    scene: {
      ...result.scene,
      revision: currentScene.revision,
    },
  };
}

/** Save scene and optionally trigger browser download */
export function saveSceneAndDownload(scene: SceneV1, filename?: string): void {
  const json = serializeScene(scene);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `beambench-scene-${scene.sceneId}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Create undo/redo history entry */
export interface HistoryEntry {
  timestamp: number;
  scene: SceneV1;
  description?: string;
}

/** Deep copy a scene so history entries cannot be mutated by later commands */
function copyScene(scene: SceneV1): SceneV1 {
  return structuredClone(scene);
}

export class SceneHistory {
  private entries: HistoryEntry[] = [];
  private currentIndex = -1;
  private maxEntries = 50; // PLAN specifies 50-step undo

  push(scene: SceneV1, description?: string): void {
    // Remove future entries if we're not at the end
    if (this.currentIndex < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.currentIndex + 1);
    }

    // Add new entry
    this.currentIndex++;
    this.entries[this.currentIndex] = {
      timestamp: Date.now(),
      scene: copyScene(scene),
      description,
    };

    // Trim to max size
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
      this.currentIndex--;
    }
  }

  undo(): SceneV1 | null {
    if (this.currentIndex <= 0) return null;

    this.currentIndex--;
    return copyScene(this.entries[this.currentIndex].scene);
  }

  redo(): SceneV1 | null {
    if (this.currentIndex >= this.entries.length - 1) return null;

    this.currentIndex++;
    return copyScene(this.entries[this.currentIndex].scene);
  }

  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  canRedo(): boolean {
    return this.currentIndex < this.entries.length - 1;
  }

  clear(): void {
    this.entries = [];
    this.currentIndex = -1;
  }

  getHistoryLength(): number {
    return this.entries.length;
  }
}

/** Generate UUID-safe scene ID (v4 format) */
export function generateSceneId(): string {
  return crypto.randomUUID();
}

export { createEmptyScene };
