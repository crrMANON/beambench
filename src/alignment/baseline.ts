/**
 * BB-08 Alignment baseline
 *
 * A deterministic, auditable baseline for the two-mirror and collimation tasks:
 * - scenario-driven control limits and target
 * - finite-difference Jacobian + damped least squares
 * - bounded steps, clamped controls, explicit termination reasons
 * - multi-seed baseline runs with a versioned PRNG
 *
 * Model scope (v1): paraxial geometry only. The two-mirror model maps tilt
 * angles to target-plane position/angle; the collimation model maps lens
 * offset/tilt to position/angle. Ray tracing and thin-lens q propagation are
 * not part of this baseline; the fixtures are analytic so results stay stable.
 */

import { createRng, PRNG_VERSION } from '../core/rng';

export type AlignmentType = 'two-mirror' | 'collimation';
export type AlignmentStatus =
  | 'CONVERGED'
  | 'MAX_ITERATIONS'
  | 'UNREACHABLE'
  | 'NO_IMPROVEMENT'
  | 'INVALID';

export interface ControlSpec {
  name: string;
  min: number;
  max: number;
  initial: number;
}

export interface AlignmentGeometry {
  d1_m?: number;
  d2_m?: number;
  L_m: number;
  targetY_m: number;
  targetAngleRad: number;
}

export interface AlignmentScenario {
  schemaVersion: 1;
  name: string;
  type: AlignmentType;
  description?: string;
  geometry: AlignmentGeometry;
  controls: ControlSpec[];
  tolerance: number;
  maxIterations: number;
}

export interface AlignmentResult {
  scenario: string;
  status: AlignmentStatus;
  iterations: number;
  controls: Record<string, number>;
  residual: number[];
  residualNorm: number;
  history: { iteration: number; residualNorm: number; controls: Record<string, number> }[];
  reason?: string;
}

export interface SolverOptions {
  maxStep?: number;
  damping?: number;
}

export interface BaselineResult {
  scenario: string;
  prngVersion: string;
  seeds: number[];
  perturbation: number;
  results: AlignmentResult[];
  successCount: number;
  allSucceeded: boolean;
}

const REQUIRED_CONTROLS: Record<AlignmentType, string[]> = {
  'two-mirror': ['theta1', 'theta2'],
  collimation: ['lensX_m', 'lensTiltRad'],
};

/** Parse and validate a scenario object (never mutates the input). */
export function parseAlignmentScenario(raw: unknown): AlignmentScenario {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Scenario must be an object');
  }
  const data = raw as Partial<AlignmentScenario>;

  if (data.schemaVersion !== 1) throw new Error('Unsupported scenario schemaVersion');
  if (typeof data.name !== 'string' || data.name.length === 0) {
    throw new Error('Scenario name is required');
  }
  if (data.type !== 'two-mirror' && data.type !== 'collimation') {
    throw new Error(`Unknown scenario type: ${String(data.type)}`);
  }
  if (!data.geometry || !Number.isFinite(data.geometry.L_m) ||
      !Number.isFinite(data.geometry.targetY_m) ||
      !Number.isFinite(data.geometry.targetAngleRad)) {
    throw new Error('Scenario geometry is invalid');
  }
  if (data.type === 'two-mirror') {
    if (!Number.isFinite(data.geometry.d1_m) || !Number.isFinite(data.geometry.d2_m)) {
      throw new Error('Two-mirror geometry requires d1_m and d2_m');
    }
  }
  if (!Array.isArray(data.controls) || data.controls.length !== 2) {
    throw new Error('Scenario needs exactly two controls');
  }

  const names = new Set<string>();
  const controls: ControlSpec[] = data.controls.map((control) => {
    if (!control || typeof control.name !== 'string') {
      throw new Error('Control name is required');
    }
    if (names.has(control.name)) throw new Error(`Duplicate control: ${control.name}`);
    names.add(control.name);
    if (![control.min, control.max, control.initial].every(
      (value) => typeof value === 'number' && Number.isFinite(value)
    )) {
      throw new Error(`Control ${control.name} has non-finite values`);
    }
    if (control.min >= control.max) {
      throw new Error(`Control ${control.name} has min >= max`);
    }
    if (control.initial < control.min || control.initial > control.max) {
      throw new Error(`Control ${control.name} initial value is outside its limits`);
    }
    return {
      name: control.name,
      min: control.min,
      max: control.max,
      initial: control.initial,
    };
  });

  for (const required of REQUIRED_CONTROLS[data.type]) {
    if (!names.has(required)) {
      throw new Error(`Scenario ${data.type} is missing control ${required}`);
    }
  }

  if (!Number.isFinite(data.tolerance) || (data.tolerance as number) <= 0) {
    throw new Error('tolerance must be positive');
  }
  if (!Number.isInteger(data.maxIterations) || (data.maxIterations as number) <= 0) {
    throw new Error('maxIterations must be a positive integer');
  }

  return {
    schemaVersion: 1,
    name: data.name,
    type: data.type,
    description: data.description,
    geometry: { ...data.geometry },
    controls,
    tolerance: data.tolerance as number,
    maxIterations: data.maxIterations as number,
  };
}

function valueByName(
  scenario: AlignmentScenario,
  values: number[],
  name: string
): number {
  const index = scenario.controls.findIndex((control) => control.name === name);
  if (index < 0) throw new Error(`Missing control ${name}`);
  return values[index];
}

/**
 * Analytic residuals for the supported fixtures.
 * Residuals are `output - target`; zero means aligned.
 */
export function residualFor(scenario: AlignmentScenario, values: number[]): number[] {
  const g = scenario.geometry;

  if (scenario.type === 'two-mirror') {
    const theta1 = valueByName(scenario, values, 'theta1');
    const theta2 = valueByName(scenario, values, 'theta2');
    const d1 = g.d1_m as number;
    const d2 = g.d2_m as number;
    const positionY = 2 * theta1 * (d2 - d1) + 2 * (theta1 + theta2) * (g.L_m - d2);
    const angle = 2 * (theta1 + theta2);
    return [positionY - g.targetY_m, angle - g.targetAngleRad];
  }

  const lensX = valueByName(scenario, values, 'lensX_m');
  const lensTilt = valueByName(scenario, values, 'lensTiltRad');
  const angle = 2 * lensTilt;
  const positionY = lensX + angle * g.L_m;
  return [positionY - g.targetY_m, angle - g.targetAngleRad];
}

/** Damped least-squares solve; returns null when the system is singular. */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const matrix = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-18) return null;

    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];

    for (let row = col + 1; row < n; row++) {
      const factor = matrix[row][col] / matrix[col][col];
      for (let k = col; k <= n; k++) {
        matrix[row][k] -= factor * matrix[col][k];
      }
    }
  }

  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = matrix[row][n];
    for (let col = row + 1; col < n; col++) {
      sum -= matrix[row][col] * solution[col];
    }
    solution[row] = sum / matrix[row][row];
  }
  return solution;
}

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function recordControls(scenario: AlignmentScenario, values: number[]): Record<string, number> {
  const record: Record<string, number> = {};
  scenario.controls.forEach((control, index) => {
    record[control.name] = values[index];
  });
  return record;
}

function atBound(
  scenario: AlignmentScenario,
  values: number[],
  gradient: number[]
): boolean {
  return scenario.controls.some((control, index) => {
    const value = values[index];
    const atMin = Math.abs(value - control.min) < 1e-12 && gradient[index] < 0;
    const atMax = Math.abs(value - control.max) < 1e-12 && gradient[index] > 0;
    return atMin || atMax;
  });
}

/** Solve one alignment scenario from its initial controls. */
export function solveAlignment(
  scenario: AlignmentScenario,
  options: SolverOptions = {}
): AlignmentResult {
  const maxStep = options.maxStep ?? 0.02;
  let lambda = options.damping ?? 1e-3;

  const values = scenario.controls.map((control) =>
    clamp(control.initial, control.min, control.max)
  );

  let residual = residualFor(scenario, values);
  let residualNorm = norm(residual);
  const history: AlignmentResult['history'] = [
    { iteration: 0, residualNorm, controls: recordControls(scenario, values) },
  ];

  const finish = (status: AlignmentStatus, reason?: string): AlignmentResult => ({
    scenario: scenario.name,
    status,
    iterations: history.length - 1,
    controls: recordControls(scenario, values),
    residual,
    residualNorm,
    history,
    reason,
  });

  if (residualNorm <= scenario.tolerance) {
    return finish('CONVERGED');
  }

  for (let iteration = 1; iteration <= scenario.maxIterations; iteration++) {
    // Forward-difference Jacobian.
    const m = residual.length;
    const n = values.length;
    const jacobian: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const step = 1e-7 * Math.max(1, Math.abs(values[j]));
      const forward = values[j] + step <= scenario.controls[j].max;
      const h = forward ? step : -step;
      const probe = [...values];
      probe[j] += h;
      const probeResidual = residualFor(scenario, probe);
      for (let i = 0; i < m; i++) {
        jacobian[i][j] = (probeResidual[i] - residual[i]) / h;
      }
    }

    // Gradient g = J^T r and normal equations J^T J.
    const n2 = values.length;
    const gradient = new Array(n2).fill(0);
    const jtj: number[][] = Array.from({ length: n2 }, () => new Array(n2).fill(0));
    for (let i = 0; i < m; i++) {
      for (let a = 0; a < n2; a++) {
        gradient[a] += jacobian[i][a] * residual[i];
        for (let b = 0; b < n2; b++) {
          jtj[a][b] += jacobian[i][a] * jacobian[i][b];
        }
      }
    }

    let accepted = false;
    let nextValues = values;
    let nextResidual = residual;
    let nextNorm = residualNorm;

    for (let retry = 0; retry < 10; retry++) {
      const A = jtj.map((row, a) =>
        row.map((value, b) => value + (a === b ? lambda : 0))
      );
      const rhs = gradient.map((value) => -value);
      const delta = solveLinearSystem(A, rhs);

      if (!delta || delta.some((value) => !Number.isFinite(value))) {
        lambda *= 10;
        continue;
      }

      const candidate = values.map((value, index) =>
        clamp(
          value + clamp(delta[index], -maxStep, maxStep),
          scenario.controls[index].min,
          scenario.controls[index].max
        )
      );

      const moved = candidate.some((value, index) => Math.abs(value - values[index]) > 1e-15);
      if (!moved) {
        lambda *= 10;
        continue;
      }

      const candidateResidual = residualFor(scenario, candidate);
      const candidateNorm = norm(candidateResidual);

      if (candidateNorm < residualNorm) {
        accepted = true;
        nextValues = candidate;
        nextResidual = candidateResidual;
        nextNorm = candidateNorm;
        lambda = Math.max(lambda / 3, 1e-12);
        break;
      }
      lambda *= 10;
    }

    if (!accepted) {
      const status: AlignmentStatus = atBound(scenario, values, gradient)
        ? 'UNREACHABLE'
        : 'NO_IMPROVEMENT';
      return finish(status, `Residual ${residualNorm.toExponential(3)} cannot be improved`);
    }

    values.splice(0, values.length, ...nextValues);
    residual = nextResidual;
    residualNorm = nextNorm;
    history.push({
      iteration,
      residualNorm,
      controls: recordControls(scenario, values),
    });

    if (residualNorm <= scenario.tolerance) {
      return finish('CONVERGED');
    }
  }

  return finish('MAX_ITERATIONS', 'Iteration budget exhausted');
}

/**
 * Run the baseline across seeds. Each seed perturbs the initial controls
 * deterministically; the scenario object itself is never modified.
 */
export function runAlignmentBaseline(
  scenario: AlignmentScenario,
  seeds: number[] = Array.from({ length: 20 }, (_, i) => i),
  perturbation = 0.005
): BaselineResult {
  const results = seeds.map((seed) => {
    const rng = createRng(seed);
    const perturbed: AlignmentScenario = {
      ...scenario,
      geometry: { ...scenario.geometry },
      controls: scenario.controls.map((control) => {
        const offset = (rng() * 2 - 1) * perturbation;
        return {
          ...control,
          initial: clamp(control.initial + offset, control.min, control.max),
        };
      }),
    };
    return solveAlignment(perturbed);
  });

  const successCount = results.filter((result) => result.status === 'CONVERGED').length;

  return {
    scenario: scenario.name,
    prngVersion: PRNG_VERSION,
    seeds: [...seeds],
    perturbation,
    results,
    successCount,
    allSucceeded: successCount === seeds.length,
  };
}
