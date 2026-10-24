/**
 * Domain contract tests — exercise the real modules (no mock re-implementations).
 *
 * Covers BB-AC02 (save/load roundtrip, invalid input never replaces state) and
 * BB-03 concurrency/idempotency guarantees from PLAN §3.2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEmptyScene,
  deserializeScene,
  loadScene,
  SceneHistory,
  serializeScene,
} from '../../src/domain/scene-io';
import { validateScene, isValidQuaternion } from '../../src/domain/scene-validation';
import { CommandExecutor } from '../../src/domain/commands';
import { SceneV1 } from '../../src/domain/scene';

const MOUNT = {
  pivotPoint: [0, 0, 0] as [number, number, number],
  axes: {
    tiltX: { min: -0.1, max: 0.1 },
    tiltY: { min: -0.1, max: 0.1 },
    rotationZ: { min: 0, max: Math.PI },
  },
};

function addMirror(executor: CommandExecutor, requestId: string) {
  return executor.execute({
    protocolVersion: 1,
    requestId,
    expectedRevision: executor.getRevision(),
    method: 'add',
    args: {
      kind: 'mirror',
      pose: {
        position: [0.1, 0.1, 0.05],
        orientation: [0, 0, 0, 1],
      },
      mount: MOUNT,
      props: { reflectivity: 0.99 },
      active: true,
    },
  });
}

describe('SceneV1 real roundtrip', () => {
  it('preserves every serialized field', () => {
    const scene = createEmptyScene(undefined, 42);
    scene.meta = { title: 'roundtrip', scenarioType: 'test' };
    scene.elements.push({
      uuid: crypto.randomUUID(),
      kind: 'source',
      name: 'laser',
      active: true,
      pose: { position: [0.25, 0.125, -0.5], orientation: [0, 0, 0, 1] },
      mount: MOUNT,
      props: {
        wavelength_nm: 532,
        forward_cm: 100,
        backward_cm: 0,
        polPreset: 'H',
        intensity_rel: 1,
      },
    });

    const result = deserializeScene(serializeScene(scene));

    expect(result.valid).toBe(true);
    expect(result.scene).toBeDefined();
    expect(result.scene).toEqual(scene);
  });

  it('rejects invalid version without replacing the current scene', () => {
    const current = createEmptyScene();
    const json = JSON.stringify({ ...JSON.parse(serializeScene(current)), version: 99 });

    const result = loadScene(current, json);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported schema version');
  });

  it('rejects NaN, duplicate UUIDs and malformed tuples', () => {
    const scene = createEmptyScene();
    const element = {
      uuid: crypto.randomUUID(),
      kind: 'source' as const,
      active: true,
      pose: { position: [0, 0.1, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] },
      mount: MOUNT,
      props: { wavelength_nm: 532, forward_cm: 100, backward_cm: 0 },
    };

    expect(validateScene({ ...scene, elements: [{ ...element, pose: { ...element.pose, position: [NaN, 0, 0] } }] }).valid).toBe(false);
    expect(validateScene({ ...scene, elements: [element, { ...element }] }).valid).toBe(false);

    const malformed = JSON.stringify({
      ...JSON.parse(serializeScene({ ...scene, elements: [element] })),
      elements: [{ ...element, pose: { position: [0, 0] } }],
    });
    expect(deserializeScene(malformed).valid).toBe(false);
  });

  it('accepts normalized quaternions only', () => {
    expect(isValidQuaternion([0, 0, 0, 1])).toBe(true);
    expect(isValidQuaternion([1, 0, 0, 0])).toBe(true);
    expect(isValidQuaternion([0, 0, 0, 2])).toBe(false);
  });

  it('history snapshots are isolated from later mutations', () => {
    const history = new SceneHistory();
    const scene: SceneV1 = createEmptyScene();
    history.push(scene);
    scene.elements.push({
      uuid: crypto.randomUUID(), kind: 'iris', active: true,
      pose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      mount: MOUNT, props: { radius_m: 0.01 },
    });
    history.push(scene);
    scene.elements.length = 0;

    const undone = history.undo();
    expect(undone?.elements.length).toBe(0);
    expect(history.redo()?.elements.length).toBe(1);
  });
});

describe('Command executor contract', () => {
  let executor: CommandExecutor;

  beforeEach(() => {
    executor = new CommandExecutor();
  });

  it('read-only commands do not advance revision', async () => {
    const state = await executor.execute({
      protocolVersion: 1, requestId: 'read-1', expectedRevision: 0,
      method: 'get_state', args: null,
    });
    const observation = await executor.execute({
      protocolVersion: 1, requestId: 'read-2', expectedRevision: 0,
      method: 'observe', args: null,
    });

    expect(state.ok).toBe(true);
    expect(observation.ok).toBe(true);
    expect(executor.getRevision()).toBe(0);
  });

  it('rejects a reused requestId with different args', async () => {
    const first = await executor.execute({
      protocolVersion: 1, requestId: 'dup', expectedRevision: 0,
      method: 'get_state', args: null,
    });
    const conflict = await executor.execute({
      protocolVersion: 1, requestId: 'dup', expectedRevision: 0,
      method: 'get_state', args: { unexpected: true },
    });

    expect(first.ok).toBe(true);
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toBe('VALIDATION');
  });

  it('rejects unknown UUIDs and preserves state', async () => {
    const before = executor.getCurrentScene();
    const response = await executor.execute({
      protocolVersion: 1, requestId: 'bad-uuid', expectedRevision: 0,
      method: 'remove', args: { uuid: crypto.randomUUID() },
    });

    expect(response.ok).toBe(false);
    expect(response.error).toBe('VALIDATION');
    expect(executor.getCurrentScene()).toEqual(before);
    expect(executor.getRevision()).toBe(0);
  });

  it('applies setPose/setParam/setDof atomically', async () => {
    const added = await addMirror(executor, 'add-1');
    const uuid = (added.result as { uuid?: string } | undefined)?.uuid ??
      executor.getCurrentScene().elements[0].uuid;

    const moved = await executor.execute({
      protocolVersion: 1, requestId: 'pose', expectedRevision: 1,
      method: 'setPose',
      args: { uuid, pose: { position: [0.2, 0.2, 0.1], orientation: [0, 0, 0, 1] } },
    });
    const param = await executor.execute({
      protocolVersion: 1, requestId: 'param', expectedRevision: 2,
      method: 'setParam', args: { uuid, param: 'reflectivity', value: 0.9 },
    });
    const dof = await executor.execute({
      protocolVersion: 1, requestId: 'dof', expectedRevision: 3,
      method: 'setDof', args: { uuid, axis: 'tiltX', value: [-0.2, 0.2] },
    });

    expect(moved.ok).toBe(true);
    expect(param.ok).toBe(true);
    expect(dof.ok).toBe(true);

    const element = executor.getCurrentScene().elements[0];
    expect(element.pose.position).toEqual([0.2, 0.2, 0.1]);
    expect(element.props.reflectivity).toBe(0.9);
    expect(element.mount.axes.tiltX).toEqual({ min: -0.2, max: 0.2 });
    expect(executor.getRevision()).toBe(4);
  });

  it('loads a serialized scene and advances revision once', async () => {
    const source = createEmptyScene(undefined, 7);
    const json = serializeScene(source);

    const response = await executor.execute({
      protocolVersion: 1, requestId: 'load', expectedRevision: 0,
      method: 'load_scene', args: json,
    });

    expect(response.ok).toBe(true);
    expect(executor.getRevision()).toBe(1);
    expect(executor.getCurrentScene().seed).toBe(7);
  });

  it('undo/redo keep revisions monotonic and restore state', async () => {
    await addMirror(executor, 'add-1');
    expect(executor.getCurrentScene().elements.length).toBe(1);

    const undo = await executor.execute({
      protocolVersion: 1, requestId: 'undo', expectedRevision: 1,
      method: 'undo', args: null,
    });
    expect(undo.ok).toBe(true);
    expect(undo.revision).toBe(2);
    expect(executor.getCurrentScene().elements.length).toBe(0);

    const redo = await executor.execute({
      protocolVersion: 1, requestId: 'redo', expectedRevision: 2,
      method: 'redo', args: null,
    });
    expect(redo.ok).toBe(true);
    expect(redo.revision).toBe(3);
    expect(executor.getCurrentScene().elements.length).toBe(1);
  });

  it('100 placements produce unique UUIDs and remove cleanly', async () => {
    const uuids: string[] = [];

    for (let i = 0; i < 100; i++) {
      const response = await executor.execute({
        protocolVersion: 1,
        requestId: `place-${i}`,
        expectedRevision: executor.getRevision(),
        method: 'add',
        args: {
          kind: 'iris',
          pose: {
            position: [(i % 10) * 0.025, 0, Math.floor(i / 10) * 0.025],
            orientation: [0, 0, 0, 1],
          },
          mount: MOUNT,
          props: { radius_m: 0.005 },
          active: true,
        },
      });
      expect(response.ok).toBe(true);
      uuids.push((response.result as { uuid: string }).uuid);
    }

    expect(new Set(uuids).size).toBe(100);
    expect(executor.getCurrentScene().elements).toHaveLength(100);

    for (let i = 0; i < 100; i++) {
      const response = await executor.execute({
        protocolVersion: 1,
        requestId: `remove-${i}`,
        expectedRevision: executor.getRevision(),
        method: 'remove',
        args: { uuid: uuids[i] },
      });
      expect(response.ok).toBe(true);
    }

    expect(executor.getCurrentScene().elements).toHaveLength(0);
    expect(executor.getRevision()).toBe(200);
  });
});
