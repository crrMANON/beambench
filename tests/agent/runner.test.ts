/**
 * BB-11 agent loop tests: budgets, protection, replay determinism, capture refs.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentAction,
  AgentEnvironment,
  AgentFrame,
  AgentObservation,
  AgentPolicy,
  DEFAULT_AGENT_BUDGET,
  runAgent,
} from '../../src/agent/runner';
import type { CommandMethod, CommandResponse } from '../../src/domain/commands';
import type { CaptureView } from '../../src/render/capture';

class FakeEnvironment implements AgentEnvironment {
  revision = 0;
  signal = 0.3;
  executeCalls: Array<{ method: CommandMethod; args: unknown }> = [];
  captureCalls: CaptureView[] = [];
  frames = 0;

  getRevision(): number {
    return this.revision;
  }

  async observe(): Promise<AgentObservation> {
    return { revision: this.revision, signal: this.signal };
  }

  score(observation: AgentObservation): number {
    return Number(observation.signal);
  }

  async capture(view: CaptureView): Promise<AgentFrame> {
    this.captureCalls.push(view);
    this.frames++;
    return { revision: this.revision, view, frameId: this.frames };
  }

  async execute(method: CommandMethod, args: unknown): Promise<CommandResponse> {
    this.executeCalls.push({ method, args });
    if (method === 'setParam' && args && typeof args === 'object' &&
        typeof (args as { value?: unknown }).value === 'number') {
      this.signal = (args as { value: number }).value;
    }
    this.revision++;
    return { requestId: `env-${this.revision}`, ok: true, revision: this.revision };
  }
}

function scripted(actions: AgentAction[]): AgentPolicy {
  let index = 0;
  return () => actions[Math.min(index++, actions.length - 1)];
}

const baseOptions = {
  runId: 'run-1',
  policyName: 'scripted',
  budget: { maxSteps: 5, maxNoImprovement: 5, maxCaptures: 5, successThreshold: 1, improvementEpsilon: 1e-9 },
};

describe('Agent budgets', () => {
  it('converges when the score reaches the threshold', async () => {
    const env = new FakeEnvironment();
    const policy = scripted([
      { type: 'command', method: 'setParam', args: { uuid: 'mirror-1', param: 'x', value: 0.6 } },
      { type: 'command', method: 'setParam', args: { uuid: 'mirror-1', param: 'x', value: 1.2 } },
    ]);

    const record = await runAgent(env, policy, baseOptions);

    expect(record.status).toBe('CONVERGED');
    expect(record.steps).toHaveLength(2);
    expect(record.finalScore).toBe(1.2);
    expect(env.executeCalls).toHaveLength(2);
  });

  it('stops at the step budget', async () => {
    const env = new FakeEnvironment();
    const policy = scripted([{ type: 'capture', view: 'top' }]);

    const record = await runAgent(env, policy, {
      ...baseOptions,
      budget: { ...baseOptions.budget, maxSteps: 3, maxNoImprovement: 100 },
    });

    expect(record.status).toBe('BUDGET_STEPS');
    expect(record.steps).toHaveLength(3);
    expect(env.captureCalls).toHaveLength(3);
  });

  it('stops after repeated non-improvement', async () => {
    const env = new FakeEnvironment();
    const policy = scripted([{ type: 'capture', view: 'side' }]);

    const record = await runAgent(env, policy, {
      ...baseOptions,
      budget: { ...baseOptions.budget, maxSteps: 20, maxNoImprovement: 2, maxCaptures: 20 },
    });

    expect(record.status).toBe('NO_IMPROVEMENT');
    expect(record.steps.length).toBeLessThan(20);
  });

  it('stops when the policy requests it', async () => {
    const env = new FakeEnvironment();
    const record = await runAgent(
      env,
      scripted([{ type: 'stop', reason: 'human review' }]),
      baseOptions
    );

    expect(record.status).toBe('STOPPED');
    expect(record.terminationReason).toBe('human review');
  });

  it('reports a capture budget without executing extra work', async () => {
    const env = new FakeEnvironment();
    const record = await runAgent(
      env,
      scripted([{ type: 'capture', view: 'front' }]),
      {
        ...baseOptions,
        budget: { ...baseOptions.budget, maxSteps: 3, maxNoImprovement: 10, maxCaptures: 1 },
      }
    );

    expect(env.captureCalls).toHaveLength(1);
    expect(record.steps[1].rejected).toMatch(/Capture budget/);
    expect(record.steps[2].rejected).toMatch(/Capture budget/);
  });
});

describe('Agent protection', () => {
  it('refuses to move a protected source', async () => {
    const env = new FakeEnvironment();
    const record = await runAgent(
      env,
      scripted([{
        type: 'command',
        method: 'setPose',
        args: { uuid: 'src-1', pose: { position: [1, 1, 1], orientation: [0, 0, 0, 1] } },
      }]),
      {
        ...baseOptions,
        protectedUuids: ['src-1'],
        budget: { ...baseOptions.budget, maxSteps: 2, maxNoImprovement: 10 },
      }
    );

    expect(env.executeCalls).toHaveLength(0);
    expect(record.steps[0].rejected).toMatch(/Protected element/);
    expect(record.steps[1].rejected).toMatch(/Protected element/);
  });

  it('refuses forbidden methods', async () => {
    const env = new FakeEnvironment();
    const record = await runAgent(
      env,
      scripted([{ type: 'command', method: 'load_scene', args: {} }]),
      {
        ...baseOptions,
        budget: { ...baseOptions.budget, maxSteps: 1, maxNoImprovement: 10 },
      }
    );

    expect(env.executeCalls).toHaveLength(0);
    expect(record.steps[0].rejected).toMatch(/forbidden/i);
  });

  it('records capture frames with their revision', async () => {
    const env = new FakeEnvironment();
    const record = await runAgent(
      env,
      scripted([{ type: 'capture', view: 'top' }]),
      {
        ...baseOptions,
        budget: { ...baseOptions.budget, maxSteps: 1, maxNoImprovement: 10 },
      }
    );

    expect(record.steps[0].frame).toEqual({ revision: 0, view: 'top', frameId: 1 });
  });
});

describe('Agent replay', () => {
  it('produces an identical record for the same policy and environment', async () => {
    const actions: AgentAction[] = [
      { type: 'command', method: 'setParam', args: { uuid: 'm', param: 'x', value: 0.5 } },
      { type: 'capture', view: 'perspective' },
      { type: 'command', method: 'setParam', args: { uuid: 'm', param: 'x', value: 1.5 } },
    ];

    const first = await runAgent(new FakeEnvironment(), scripted(actions), baseOptions);
    const second = await runAgent(new FakeEnvironment(), scripted(actions), baseOptions);

    expect(second).toEqual(first);
  });

  it('runs 20 independent rounds without shared state', async () => {
    const records = [];
    for (let seed = 0; seed < 20; seed++) {
      const env = new FakeEnvironment();
      records.push(await runAgent(
        env,
        scripted([
          { type: 'command', method: 'setParam', args: { uuid: 'm', param: 'x', value: 2 } },
        ]),
        { ...baseOptions, runId: `run-${seed}` }
      ));
    }

    expect(records.every((record) => record.status === 'CONVERGED')).toBe(true);
    expect(new Set(records.map((record) => record.runId)).size).toBe(20);
  });

  it('does not log prompts, tokens or secrets', async () => {
    const env = new FakeEnvironment();
    const record = await runAgent(env, scripted([{ type: 'stop' }]), baseOptions);
    const serialized = JSON.stringify(record);

    expect(serialized).not.toMatch(/token|api[_-]?key|prompt|chain[_-]?of[_-]?thought/i);
  });

  it('uses the documented default budget', () => {
    expect(DEFAULT_AGENT_BUDGET.maxSteps).toBe(20);
    expect(DEFAULT_AGENT_BUDGET.maxCaptures).toBe(10);
  });
});

describe('Agent error handling', () => {
  it('marks the run failed when capture throws', async () => {
    const env = new FakeEnvironment();
    env.capture = async () => {
      throw new Error('renderer lost');
    };

    const record = await runAgent(env, scripted([{ type: 'capture', view: 'top' }]), baseOptions);

    expect(record.status).toBe('ERROR');
    expect(record.terminationReason).toMatch(/capture failed/);
  });

  it('marks the run failed when the policy throws', async () => {
    const env = new FakeEnvironment();
    const record = await runAgent(env, () => {
      throw new Error('policy bug');
    }, baseOptions);

    expect(record.status).toBe('ERROR');
    expect(record.terminationReason).toMatch(/policy failed/);
  });
});
