/**
 * UI command executor tests with an in-memory UI adapter.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BaseElement, ElementKind, SceneV1 } from '../../src/domain/scene';
import { createEmptyScene } from '../../src/domain/scene-io';
import { UiActions, UiCommandExecutor, UiPose } from '../../src/integration/ui-commands';
import type { CommandRequest } from '../../src/domain/commands';

const MOUNT = {
  pivotPoint: [0, 0, 0] as [number, number, number],
  axes: {
    tiltX: { min: -0.1, max: 0.1 },
    tiltY: { min: -0.1, max: 0.1 },
    rotationZ: { min: 0, max: Math.PI },
  },
};

class FakeActions implements UiActions {
  items: BaseElement[] = [];
  seed = 42;
  private undoStack: BaseElement[][] = [];
  private redoStack: BaseElement[][] = [];

  private mutate(change: () => void): void {
    this.undoStack.push(structuredClone(this.items));
    this.redoStack = [];
    change();
  }

  snapshot(): SceneV1 {
    const base = createEmptyScene(undefined, this.seed);
    return {
      ...base,
      revision: 0,
      elements: structuredClone(this.items),
    };
  }

  addElement(
    kind: ElementKind,
    pose: UiPose,
    props: Record<string, unknown>,
    name?: string
  ): { uuid: string } {
    const uuid = crypto.randomUUID();
    this.mutate(() => {
      this.items.push({
        uuid,
        kind,
        name,
        active: true,
        pose: structuredClone(pose),
        mount: structuredClone(MOUNT),
        props: { ...props },
      });
    });
    return { uuid };
  }

  removeElement(uuid: string): boolean {
    if (!this.items.some((item) => item.uuid === uuid)) return false;
    this.mutate(() => {
      this.items = this.items.filter((item) => item.uuid !== uuid);
    });
    return true;
  }

  setPose(uuid: string, pose: UiPose): boolean {
    if (!this.items.some((item) => item.uuid === uuid)) return false;
    this.mutate(() => {
      this.items = this.items.map((item) =>
        item.uuid === uuid ? { ...item, pose: structuredClone(pose) } : item
      );
    });
    return true;
  }

  setParam(uuid: string, param: string, value: unknown): boolean {
    const item = this.items.find((candidate) => candidate.uuid === uuid);
    if (!item || !(param in item.props)) return false;
    this.mutate(() => {
      this.items = this.items.map((candidate) =>
        candidate.uuid === uuid
          ? { ...candidate, props: { ...candidate.props, [param]: value } }
          : candidate
      );
    });
    return true;
  }

  setDof(uuid: string, axis: 'tiltX' | 'tiltY' | 'rotationZ', min: number, max: number): boolean {
    const item = this.items.find((candidate) => candidate.uuid === uuid);
    if (!item) return false;
    this.mutate(() => {
      this.items = this.items.map((candidate) =>
        candidate.uuid === uuid
          ? { ...candidate, mount: { ...candidate.mount, axes: { ...candidate.mount.axes, [axis]: { min, max } } } }
          : candidate
      );
    });
    return true;
  }

  loadScene(scene: SceneV1): boolean {
    this.seed = scene.seed;
    this.mutate(() => {
      this.items = structuredClone(scene.elements);
    });
    return true;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(structuredClone(this.items));
    this.items = previous;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(structuredClone(this.items));
    this.items = next;
    return true;
  }
}

function request(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    protocolVersion: 1,
    requestId: `req-${Math.random()}`,
    expectedRevision: 0,
    method: 'get_state',
    args: null,
    ...overrides,
  };
}

function addMirror(executor: UiCommandExecutor, uuid?: string, requestId = 'add-1') {
  return executor.execute(request({
    requestId,
    expectedRevision: executor.getRevision(),
    method: 'add',
    args: {
      kind: 'mirror',
      pose: { position: [0.1, 0, 0.05], orientation: [0, 0, 0, 1] },
      props: { reflectivity: 0.99 },
    },
  }));
}

describe('UiCommandExecutor writes', () => {
  let actions: FakeActions;
  let executor: UiCommandExecutor;

  beforeEach(() => {
    actions = new FakeActions();
    executor = new UiCommandExecutor({
      actions,
      initialScene: createEmptyScene(undefined, 42),
    });
  });

  it('adds an element and advances the revision', async () => {
    const before = executor.getRevision();
    const response = await addMirror(executor);

    expect(response.ok).toBe(true);
    expect(response.revision).toBe(before + 1);
    const uuid = (response.result as { uuid: string }).uuid;
    expect(uuid).toBeTruthy();

    const scene = executor.getScene();
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0].uuid).toBe(uuid);
    expect(scene.elements[0].kind).toBe('mirror');
  });

  it('updates pose and params, then removes the element', async () => {
    const added = await addMirror(executor);
    const uuid = (added.result as { uuid: string }).uuid;

    const moved = await executor.execute(request({
      requestId: 'pose',
      expectedRevision: executor.getRevision(),
      method: 'setPose',
      args: { uuid, pose: { position: [0.2, 0.01, 0.1], orientation: [0, 0, 0, 1] } },
    }));
    expect(moved.ok).toBe(true);
    expect(executor.getScene().elements[0].pose.position).toEqual([0.2, 0.01, 0.1]);

    const tuned = await executor.execute(request({
      requestId: 'param',
      expectedRevision: executor.getRevision(),
      method: 'setParam',
      args: { uuid, param: 'reflectivity', value: 0.8 },
    }));
    expect(tuned.ok).toBe(true);
    expect(executor.getScene().elements[0].props.reflectivity).toBe(0.8);

    const removed = await executor.execute(request({
      requestId: 'remove',
      expectedRevision: executor.getRevision(),
      method: 'remove',
      args: { uuid },
    }));
    expect(removed.ok).toBe(true);
    expect(executor.getScene().elements).toHaveLength(0);
  });

  it('supports undo and redo through the adapter', async () => {
    await addMirror(executor);
    expect(executor.getScene().elements).toHaveLength(1);

    const undo = await executor.execute(request({
      requestId: 'undo',
      expectedRevision: executor.getRevision(),
      method: 'undo',
      args: null,
    }));
    expect(undo.ok).toBe(true);
    expect(executor.getScene().elements).toHaveLength(0);

    const redo = await executor.execute(request({
      requestId: 'redo',
      expectedRevision: executor.getRevision(),
      method: 'redo',
      args: null,
    }));
    expect(redo.ok).toBe(true);
    expect(executor.getScene().elements).toHaveLength(1);
  });

  it('rejects unknown UUIDs without advancing the revision', async () => {
    const before = executor.getRevision();
    const response = await executor.execute(request({
      requestId: 'missing',
      expectedRevision: before,
      method: 'remove',
      args: { uuid: crypto.randomUUID() },
    }));

    expect(response.error).toBe('VALIDATION');
    expect(executor.getRevision()).toBe(before);
  });

  it('rejects malformed poses and unknown params', async () => {
    const added = await addMirror(executor);
    const uuid = (added.result as { uuid: string }).uuid;

    const badPose = await executor.execute(request({
      requestId: 'bad-pose',
      expectedRevision: executor.getRevision(),
      method: 'setPose',
      args: { uuid, pose: { position: [NaN, 0, 0], orientation: [0, 0, 0, 1] } },
    }));
    expect(badPose.error).toBe('VALIDATION');

    const badParam = await executor.execute(request({
      requestId: 'bad-param',
      expectedRevision: executor.getRevision(),
      method: 'setParam',
      args: { uuid, param: 'nope', value: 1 },
    }));
    expect(badParam.error).toBe('VALIDATION');
  });

  it('rejects stale revisions', async () => {
    const response = await addMirror(executor);
    const stale = await executor.execute(request({
      requestId: 'stale',
      expectedRevision: (response.revision as number) - 1,
      method: 'add',
      args: {
        kind: 'mirror',
        pose: { position: [0.1, 0, 0.05], orientation: [0, 0, 0, 1] },
        props: {},
      },
    }));
    expect(stale.error).toBe('STALE_REVISION');
    expect(executor.getScene().elements).toHaveLength(1);
  });

  it('is idempotent for retried writes', async () => {
    const first = await addMirror(executor, undefined, 'retry');
    const second = await addMirror(executor, undefined, 'retry');

    expect(second).toEqual(first);
    expect(executor.getScene().elements).toHaveLength(1);
  });

  it('updates mechanical DOF limits', async () => {
    const added = await addMirror(executor);
    const uuid = (added.result as { uuid: string }).uuid;

    const dof = await executor.execute(request({
      requestId: 'dof',
      expectedRevision: executor.getRevision(),
      method: 'setDof',
      args: { uuid, axis: 'tiltX', value: [-0.02, 0.02] },
    }));
    expect(dof.ok).toBe(true);
    expect(executor.getScene().elements[0].mount.axes.tiltX).toEqual({ min: -0.02, max: 0.02 });

    const invalid = await executor.execute(request({
      requestId: 'dof-bad',
      expectedRevision: executor.getRevision(),
      method: 'setDof',
      args: { uuid, axis: 'tiltX', value: [0.1, -0.1] },
    }));
    expect(invalid.error).toBe('VALIDATION');
  });

  it('loads a serialized scene and resets to an empty one', async () => {
    const added = await addMirror(executor);
    const uuid = (added.result as { uuid: string }).uuid;
    const saved = await executor.execute(request({
      requestId: 'save',
      expectedRevision: executor.getRevision(),
      method: 'save_scene',
    }));
    const json = (saved.result as { json: string }).json;

    const reset = await executor.execute(request({
      requestId: 'reset',
      expectedRevision: saved.revision as number,
      method: 'reset',
      args: { seed: 99 },
    }));
    expect(reset.ok).toBe(true);
    expect(executor.getScene().elements).toHaveLength(0);
    expect(executor.getScene().seed).toBe(99);

    const loaded = await executor.execute(request({
      requestId: 'load',
      expectedRevision: reset.revision as number,
      method: 'load_scene',
      args: { json },
    }));
    expect(loaded.ok).toBe(true);
    expect(executor.getScene().elements).toHaveLength(1);
    expect(executor.getScene().elements[0].uuid).toBe(uuid);
  });

  it('keeps read commands working after writes', async () => {
    const added = await addMirror(executor);
    const revision = added.revision as number;

    const state = await executor.execute(request({
      requestId: 'state',
      expectedRevision: revision,
      method: 'get_state',
    }));
    expect(state.ok).toBe(true);
    expect((state.result as SceneV1).elements).toHaveLength(1);
  });
});
