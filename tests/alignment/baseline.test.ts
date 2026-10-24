/**
 * BB-08 alignment baseline tests: convergence, 20-seed determinism, unreachable
 * fixtures, bounds, and scenario immutability.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  AlignmentScenario,
  parseAlignmentScenario,
  residualFor,
  runAlignmentBaseline,
  solveAlignment,
} from '../../src/alignment/baseline';

function loadScenario(name: string): AlignmentScenario {
  const path = resolve(process.cwd(), 'scenarios', `${name}.json`);
  return parseAlignmentScenario(JSON.parse(readFileSync(path, 'utf-8')));
}

const TWO_MIRROR = loadScenario('two-mirror');
const COLLIMATION = loadScenario('collimation');

describe('Scenario parsing', () => {
  it('loads the checked-in fixtures', () => {
    expect(TWO_MIRROR.type).toBe('two-mirror');
    expect(TWO_MIRROR.controls.map((c) => c.name)).toEqual(['theta1', 'theta2']);
    expect(COLLIMATION.type).toBe('collimation');
    expect(COLLIMATION.controls.map((c) => c.name)).toEqual(['lensX_m', 'lensTiltRad']);
  });

  it('rejects malformed scenarios', () => {
    const base = JSON.parse(JSON.stringify(TWO_MIRROR));
    expect(() => parseAlignmentScenario({ ...base, schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => parseAlignmentScenario({ ...base, controls: [] })).toThrow(/two controls/);
    expect(() => parseAlignmentScenario({
      ...base,
      controls: [
        { name: 'theta1', min: 0, max: 0, initial: 0 },
        { name: 'theta2', min: -1, max: 1, initial: 0 },
      ],
    })).toThrow(/min >= max/);
    expect(() => parseAlignmentScenario({
      ...base,
      controls: [
        { name: 'theta1', min: -1, max: 1, initial: 2 },
        { name: 'theta2', min: -1, max: 1, initial: 0 },
      ],
    })).toThrow(/outside its limits/);
    expect(() => parseAlignmentScenario({
      ...base,
      controls: [
        { name: 'theta1', min: -1, max: 1, initial: 0 },
        { name: 'theta1', min: -1, max: 1, initial: 0 },
      ],
    })).toThrow(/Duplicate/);
    expect(() => parseAlignmentScenario({ ...base, type: 'three-mirror' })).toThrow(/Unknown/);
  });

  it('does not mutate the input object', () => {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'scenarios/two-mirror.json'), 'utf-8'));
    const snapshot = JSON.stringify(raw);
    parseAlignmentScenario(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});

describe('Two-mirror solver', () => {
  it('reaches the analytic target', () => {
    const result = solveAlignment(TWO_MIRROR);

    expect(result.status).toBe('CONVERGED');
    expect(result.residualNorm).toBeLessThanOrEqual(TWO_MIRROR.tolerance);
    // theta1 = 0.025, theta2 = -0.025
    expect(result.controls.theta1).toBeCloseTo(0.025, 5);
    expect(result.controls.theta2).toBeCloseTo(-0.025, 5);
    expect(residualFor(TWO_MIRROR, [result.controls.theta1, result.controls.theta2])[0])
      .toBeCloseTo(0, 6);
  });

  it('keeps controls inside their limits and decreases the residual', () => {
    const result = solveAlignment(TWO_MIRROR);

    for (const control of TWO_MIRROR.controls) {
      expect(result.controls[control.name]).toBeGreaterThanOrEqual(control.min);
      expect(result.controls[control.name]).toBeLessThanOrEqual(control.max);
    }

    const norms = result.history.map((entry) => entry.residualNorm);
    for (let i = 1; i < norms.length; i++) {
      expect(norms[i]).toBeLessThanOrEqual(norms[i - 1] + 1e-12);
    }
    expect(norms[0]).toBeGreaterThan(result.residualNorm);
  });

  it('does not modify the scenario', () => {
    const snapshot = JSON.stringify(TWO_MIRROR);
    solveAlignment(TWO_MIRROR);
    expect(JSON.stringify(TWO_MIRROR)).toBe(snapshot);
  });
});

describe('Collimation solver', () => {
  it('converges to the target axis', () => {
    const result = solveAlignment(COLLIMATION);

    expect(result.status).toBe('CONVERGED');
    expect(result.controls.lensTiltRad).toBeCloseTo(0, 5);
    expect(result.controls.lensX_m).toBeCloseTo(0, 5);
    expect(result.residualNorm).toBeLessThanOrEqual(COLLIMATION.tolerance);
  });
});

describe('Multi-seed baseline', () => {
  it('succeeds for all 20 seeds on both reachable fixtures', () => {
    for (const scenario of [TWO_MIRROR, COLLIMATION]) {
      const baseline = runAlignmentBaseline(scenario);

      expect(baseline.seeds).toHaveLength(20);
      expect(baseline.prngVersion).toBe('mulberry32-v1');
      expect(baseline.allSucceeded).toBe(true);
      expect(baseline.successCount).toBe(20);
      for (const result of baseline.results) {
        expect(result.status).toBe('CONVERGED');
        expect(result.residualNorm).toBeLessThanOrEqual(scenario.tolerance);
      }
    }
  });

  it('is deterministic across runs and does not mutate the scenario', () => {
    const snapshot = JSON.stringify(TWO_MIRROR);
    const first = runAlignmentBaseline(TWO_MIRROR);
    const second = runAlignmentBaseline(TWO_MIRROR);

    expect(second).toEqual(first);
    expect(JSON.stringify(TWO_MIRROR)).toBe(snapshot);
  });

  it('reports failure for an unreachable target', () => {
    const unreachable: AlignmentScenario = {
      ...TWO_MIRROR,
      name: 'two-mirror-unreachable',
      geometry: { ...TWO_MIRROR.geometry, targetY_m: 1.0 },
    };

    const baseline = runAlignmentBaseline(unreachable, [0, 1, 2]);

    expect(baseline.allSucceeded).toBe(false);
    expect(baseline.successCount).toBe(0);
    for (const result of baseline.results) {
      expect(result.status).not.toBe('CONVERGED');
      expect(['UNREACHABLE', 'NO_IMPROVEMENT', 'MAX_ITERATIONS']).toContain(result.status);
      expect(result.residualNorm).toBeGreaterThan(unreachable.tolerance);
      for (const control of unreachable.controls) {
        expect(result.controls[control.name]).toBeGreaterThanOrEqual(control.min - 1e-12);
        expect(result.controls[control.name]).toBeLessThanOrEqual(control.max + 1e-12);
      }
    }
  });
});
