/**
 * BB-11 Budgeted agent loop
 *
 * Runs a policy through observe → capture/act → observe with hard limits:
 * - step, no-improvement and capture budgets
 * - protected elements (sources) cannot be moved, retuned or removed
 * - every step is recorded for replay; no prompts, tokens or secrets are stored
 * - the same policy + environment produces the same RunRecord
 */

import type { CommandMethod, CommandResponse } from '../domain/commands';
import type { CaptureView } from '../render/capture';

export interface AgentObservation {
  revision: number;
  [key: string]: unknown;
}

export interface AgentFrame {
  revision: number;
  view: CaptureView;
  frameId: number;
}

export interface AgentEnvironment {
  getRevision(): number;
  observe(): Promise<AgentObservation>;
  capture(view: CaptureView): Promise<AgentFrame>;
  execute(method: CommandMethod, args: unknown): Promise<CommandResponse>;
  /** Higher is better; success is score >= budget.successThreshold. */
  score(observation: AgentObservation): number;
}

export type AgentAction =
  | { type: 'command'; method: CommandMethod; args?: unknown }
  | { type: 'capture'; view: CaptureView }
  | { type: 'stop'; reason?: string };

export interface AgentBudget {
  maxSteps: number;
  maxNoImprovement: number;
  maxCaptures: number;
  successThreshold: number;
  improvementEpsilon: number;
}

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxSteps: 20,
  maxNoImprovement: 5,
  maxCaptures: 10,
  successThreshold: 1e-6,
  improvementEpsilon: 1e-9,
};

export interface AgentStepRecord {
  step: number;
  action: AgentAction;
  revision: number;
  score: number;
  response?: CommandResponse;
  frame?: AgentFrame;
  rejected?: string;
}

export type AgentStatus =
  | 'CONVERGED'
  | 'STOPPED'
  | 'NO_IMPROVEMENT'
  | 'BUDGET_STEPS'
  | 'ERROR';

export interface RunRecord {
  runId: string;
  policyName: string;
  status: AgentStatus;
  steps: AgentStepRecord[];
  finalScore: number;
  bestScore: number;
  revision: number;
  terminationReason: string;
}

export interface AgentContext {
  step: number;
  revision: number;
  observation: AgentObservation;
  score: number;
  bestScore: number;
  history: readonly AgentStepRecord[];
}

export type AgentPolicy = (context: AgentContext) => AgentAction | Promise<AgentAction>;

export interface AgentOptions {
  runId: string;
  policyName: string;
  budget?: Partial<AgentBudget>;
  /** UUIDs the agent may not move, retune or remove (typically sources). */
  protectedUuids?: readonly string[];
  /** Methods the agent may never call (defaults to load_scene). */
  forbiddenMethods?: readonly CommandMethod[];
}

function isProtectedAction(
  action: AgentAction,
  protectedUuids: ReadonlySet<string>
): string | null {
  if (action.type !== 'command' || protectedUuids.size === 0) return null;
  if (action.method !== 'remove' && action.method !== 'setPose' &&
      action.method !== 'setParam' && action.method !== 'setDof') {
    return null;
  }
  const args = action.args;
  if (!args || typeof args !== 'object') return null;
  const uuid = (args as { uuid?: unknown }).uuid;
  if (typeof uuid === 'string' && protectedUuids.has(uuid)) {
    return `Protected element cannot be modified: ${uuid}`;
  }
  return null;
}

function mergeBudget(budget?: Partial<AgentBudget>): AgentBudget {
  const merged = { ...DEFAULT_AGENT_BUDGET, ...budget };
  if (!Number.isInteger(merged.maxSteps) || merged.maxSteps <= 0) {
    throw new Error('maxSteps must be a positive integer');
  }
  if (!Number.isInteger(merged.maxNoImprovement) || merged.maxNoImprovement < 0) {
    throw new Error('maxNoImprovement must be a non-negative integer');
  }
  if (!Number.isInteger(merged.maxCaptures) || merged.maxCaptures < 0) {
    throw new Error('maxCaptures must be a non-negative integer');
  }
  return merged;
}

export async function runAgent(
  environment: AgentEnvironment,
  policy: AgentPolicy,
  options: AgentOptions
): Promise<RunRecord> {
  const budget = mergeBudget(options.budget);
  const protectedUuids = new Set(options.protectedUuids ?? []);
  const forbiddenMethods = new Set<CommandMethod>(options.forbiddenMethods ?? ['load_scene']);

  const steps: AgentStepRecord[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  let noImprovement = 0;
  let captures = 0;
  let finalScore = Number.NEGATIVE_INFINITY;
  let status: AgentStatus = 'BUDGET_STEPS';
  let terminationReason = 'Step budget exhausted';

  for (let step = 1; step <= budget.maxSteps; step++) {
    let observation: AgentObservation;
    try {
      observation = await environment.observe();
    } catch (err) {
      status = 'ERROR';
      terminationReason = `observe failed: ${(err as Error)?.message ?? String(err)}`;
      break;
    }

    const score = environment.score(observation);
    const revision = environment.getRevision();
    finalScore = score;

    if (score >= budget.successThreshold) {
      status = 'CONVERGED';
      terminationReason = `Score ${score} reached threshold`;
      break;
    }

    if (score > bestScore + budget.improvementEpsilon) {
      bestScore = score;
      noImprovement = 0;
    } else {
      noImprovement++;
    }
    if (noImprovement >= budget.maxNoImprovement) {
      status = 'NO_IMPROVEMENT';
      terminationReason = `${noImprovement} steps without improvement`;
      break;
    }

    let action: AgentAction;
    try {
      action = await policy({
        step,
        revision,
        observation,
        score,
        bestScore,
        history: steps,
      });
    } catch (err) {
      status = 'ERROR';
      terminationReason = `policy failed: ${(err as Error)?.message ?? String(err)}`;
      break;
    }

    const record: AgentStepRecord = { step, action, revision, score };

    if (action.type === 'stop') {
      steps.push(record);
      status = 'STOPPED';
      terminationReason = action.reason ?? 'Policy requested stop';
      break;
    }

    if (action.type === 'capture') {
      if (captures >= budget.maxCaptures) {
        record.rejected = 'Capture budget exhausted';
      } else {
        try {
          record.frame = await environment.capture(action.view);
          captures++;
        } catch (err) {
          record.rejected = `capture failed: ${(err as Error)?.message ?? String(err)}`;
          steps.push(record);
          status = 'ERROR';
          terminationReason = record.rejected;
          break;
        }
      }
      steps.push(record);
      continue;
    }

    if (forbiddenMethods.has(action.method)) {
      record.rejected = `Method is forbidden: ${action.method}`;
      steps.push(record);
      continue;
    }

    const protectedReason = isProtectedAction(action, protectedUuids);
    if (protectedReason) {
      record.rejected = protectedReason;
      steps.push(record);
      continue;
    }

    try {
      record.response = await environment.execute(action.method, action.args ?? null);
    } catch (err) {
      record.rejected = `execute failed: ${(err as Error)?.message ?? String(err)}`;
      steps.push(record);
      status = 'ERROR';
      terminationReason = record.rejected;
      break;
    }

    steps.push(record);
  }

  return {
    runId: options.runId,
    policyName: options.policyName,
    status,
    steps,
    finalScore,
    bestScore: Number.isFinite(bestScore) ? bestScore : finalScore,
    revision: environment.getRevision(),
    terminationReason,
  };
}
