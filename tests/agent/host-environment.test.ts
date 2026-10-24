/**
 * Agent environment tests against a real UiCommandExecutor via a local client.
 */
import { describe, it, expect } from 'vitest';
import { HostAgentEnvironment } from '../../src/agent/host-environment';
import { runAgent } from '../../src/agent/runner';
import { UiCommandExecutor, UiActions, UiPose } from '../../src/integration/ui-commands';
import { BaseElement, ElementKind, SceneV1 } from '../../src/domain/scene';
import { createEmptyScene } from '../../src/domain/scene-io';
import type { CommandMethod, CommandResponse } from '../../src/domain/commands';

const MOUNT = {
  pivotPoint: [0, 0, 0] as [number, number, number],
  axes: {
    tiltX: { min: -0.1, max: 0.1 },
    tiltY: { min: -0.1, max: 0.1 },
    rotationZ: { min: 0, max: Math.PI },
  },
};

class MemoryActions implements UiActions {
  items: BaseElement[] = [];

  snapshot(): SceneV1 {
    return {
      ...createEmptyScene(undefined, 7),
      revision: 0,
      elements: structuredClone(this.items),
    };
  }

  addElement(kind: ElementKind, pose: UiPose, props: Record<string, unknown>): { uuid: string } {
    const uuid = crypto.randomUUID();
    this.items.push({
      uuid, kind, active: true,
      pose: structuredClone(pose),
      mount: structuredClone(MOUNT),
      props: { ...props },
    });
    return { uuid };
  }

  removeElement(uuid: string): boolean {
    if (!this.items.some((item) => item.uuid === uuid)) return false;
    this.items = this.items.filter((item) => item.uuid !== uuid);
    return true;
  }

  setPose(uuid: string, pose: UiPose): boolean {
    if (!this.items.some((item) => item.uuid === uuid)) return false;
    this.items = this.items.map((item) =>
      item.uuid === uuid ? { ...item, pose: structuredClone(pose) } : item
    );
    return true;
  }

  setParam(uuid: string, param: string, value: unknown): boolean {
    const item = this.items.find((candidate) => candidate.uuid === uuid);
    if (!item || !(param in item.props)) return false;
    item.props[param] = value;
    return true;
  }
}

class LocalClient {
  revision = 0;
  private executor: UiCommandExecutor;

  constructor(executor: UiCommandExecutor) {
    this.executor = executor;
  }

  async request(
    method: CommandMethod,
    args: unknown,
    options: { expectedRevision?: number } = {}
  ): Promise<CommandResponse> {
    const response = await this.executor.execute({
      protocolVersion: 1,
      requestId: crypto.randomUUID(),
      expectedRevision: options.expectedRevision ?? this.revision,
      method,
      args,
    });
    if (typeof response.revision === 'number') this.revision = response.revision;
    return response;
  }
}

function setup() {
  const actions = new MemoryActions();
  const executor = new UiCommandExecutor({
    actions,
    initialScene: createEmptyScene(undefined, 7),
  });
  const client = new LocalClient(executor);
  const environment = new HostAgentEnvironment({
    client,
    score: (observation) => (observation as { detectors?: unknown[] }).detectors?.length ?? 0,
  });
  return { actions, executor, client, environment };
}

describe('HostAgentEnvironment', () => {
  it('tracks revisions across observe/execute', async () => {
    const { environment, executor } = setup();
    const observation = await environment.observe();
    expect(observation.revision).toBe(executor.getRevision());

    const response = await environment.execute('add', {
      kind: 'mirror',
      pose: { position: [0.1, 0, 0.1], orientation: [0, 0, 0, 1] },
      props: { reflectivity: 0.99 },
    });
    expect(response.ok).toBe(true);
    expect(environment.getRevision()).toBe(response.revision);
    expect(environment.getRevision()).toBe(executor.getRevision());
  });

  it('maps capture frames without leaking the blob into the run record', async () => {
    const { environment, executor } = setup();
    executor.setCapture({
      async capture(view, revision) {
        return {
          revision,
          view,
          frameId: 42,
          blob: new Blob(['png'], { type: 'image/png' }),
          bytes: 3,
          width: 640,
          height: 480,
        };
      },
    });

    const frame = await environment.capture('front');
    expect(frame).toEqual({ revision: executor.getRevision(), view: 'front', frameId: 42 });
  });

  it('fails observe when the host reports an error', async () => {
    const { environment } = setup();
    await environment.execute('remove', { uuid: crypto.randomUUID() });
    // Force stale revision to make observe fail.
    const staleClient = {
      request: async (method: CommandMethod, args: unknown, options: { expectedRevision?: number } = {}) => ({
        requestId: 'x',
        ok: false,
        error: 'STALE_REVISION',
      }),
    };
    const stale = new HostAgentEnvironment({ client: staleClient, score: () => 0 });
    await expect(stale.observe()).rejects.toThrow(/observe failed/);
    expect(environment.getRevision()).toBeGreaterThanOrEqual(0);
  });

  it('runs a scripted agent that builds and then stops', async () => {
    const { environment, actions } = setup();
    let step = 0;
    const policy = () => {
      step++;
      if (step === 1) {
        return {
          type: 'command' as const,
          method: 'add' as const,
          args: {
            kind: 'mirror',
            pose: { position: [0.2, 0, 0.2], orientation: [0, 0, 0, 1] },
            props: { reflectivity: 0.95 },
          },
        };
      }
      return { type: 'stop' as const, reason: 'bench built' };
    };

    const record = await runAgent(environment, policy, {
      runId: 'agent-1',
      policyName: 'scripted-build',
      budget: { maxSteps: 5, maxNoImprovement: 5, maxCaptures: 2, successThreshold: 1, improvementEpsilon: 1e-9 },
    });

    expect(record.status).toBe('STOPPED');
    expect(record.steps).toHaveLength(2);
    expect(record.steps[0].response?.ok).toBe(true);
    expect(actions.items).toHaveLength(1);
    expect(actions.items[0].kind).toBe('mirror');
  });
});
