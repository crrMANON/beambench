/**
 * BB-07 BB84 sampler tests: probability closure, loss, misalignment,
 * determinism, dark counts, and cache invalidation.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  BB84_ENGINE_COMMIT,
  Bb84OpticalModel,
  Bb84Runner,
  clickProbabilities,
  createRng,
  opticalHash,
  portBit,
  runBb84,
  statePort,
} from '../../src/qkd/bb84';

const IDEAL: Bb84OpticalModel = {
  transmission: 1,
  detectorEfficiency: 1,
  darkCountProbability: 0,
  misalignmentRad: 0,
};

describe('Port conventions', () => {
  it('maps bits and bases to ports consistently', () => {
    expect(statePort('Z', 0)).toBe('H');
    expect(statePort('Z', 1)).toBe('V');
    expect(statePort('X', 0)).toBe('D');
    expect(statePort('X', 1)).toBe('A');
    for (const port of ['H', 'V', 'D', 'A'] as const) {
      expect(statePort(port === 'H' || port === 'V' ? 'Z' : 'X', portBit(port))).toBe(port);
    }
  });
});

describe('Four-port probability closure', () => {
  const models: Bb84OpticalModel[] = [
    IDEAL,
    { ...IDEAL, transmission: 0.5 },
    { ...IDEAL, detectorEfficiency: 0.8 },
    { ...IDEAL, darkCountProbability: 0.05 },
    { ...IDEAL, transmission: 0.3, detectorEfficiency: 0.6, darkCountProbability: 0.01 },
  ];

  it('sums to one for every state/basis combination', () => {
    for (const model of models) {
      for (const aliceBasis of ['Z', 'X'] as const) {
        for (const aliceBit of [0, 1] as const) {
          for (const bobBasis of ['Z', 'X'] as const) {
            const p = clickProbabilities(model, aliceBasis, aliceBit, bobBasis);
            const total = p.noClick + p.multiClick +
              Object.values(p.ports).reduce((sum, v) => sum + v, 0);
            expect(Math.abs(total - 1)).toBeLessThanOrEqual(1e-8);
          }
        }
      }
    }
  });

  it('predicts a single certain click for an ideal lossless link', () => {
    const p = clickProbabilities(IDEAL, 'Z', 0, 'Z');
    expect(p.ports.H).toBeCloseTo(1, 12);
    expect(p.noClick).toBeCloseTo(0, 12);
    expect(p.multiClick).toBeCloseTo(0, 12);
  });

  it('puts half the events into no-click at 50% transmission', () => {
    const p = clickProbabilities({ ...IDEAL, transmission: 0.5 }, 'Z', 0, 'Z');
    expect(p.ports.H).toBeCloseTo(0.5, 12);
    expect(p.noClick).toBeCloseTo(0.5, 12);
  });

  it('randomizes outcomes in the conjugate basis', () => {
    const p = clickProbabilities(IDEAL, 'Z', 0, 'X');
    expect(p.ports.D).toBeCloseTo(0.5, 12);
    expect(p.ports.A).toBeCloseTo(0.5, 12);
    expect(p.ports.H).toBeCloseTo(0, 12);
  });
});

describe('Deterministic PRNG', () => {
  it('repeats the same stream for the same seed', () => {
    const a = createRng(123);
    const b = createRng(123);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces values in [0, 1)', () => {
    const rng = createRng(9);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('BB84 sampling', () => {
  it('produces a perfect key on an ideal lossless link', () => {
    const report = runBb84({ pulses: 5000, seed: 7, model: IDEAL });

    expect(report.engineCommit).toBe(BB84_ENGINE_COMMIT);
    expect(report.counts.noClick).toBe(0);
    expect(report.counts.doubleClick).toBe(0);
    expect(report.sifted.errors).toBe(0);
    expect(report.sifted.qber).toBe(0);
    expect(report.counts.basisMatch).toBeGreaterThan(2300);
    expect(report.counts.basisMatch).toBeLessThan(2700);
    expect(report.sifted.length).toBe(report.counts.basisMatch);
    expect(report.perDetector.H).toBeGreaterThan(1000);
    expect(report.perDetector.A).toBeGreaterThan(1000);
  });

  it('reports loss as no-click events and halves the gain', () => {
    const model = { ...IDEAL, transmission: 0.5 };
    const report = runBb84({ pulses: 20000, seed: 11, model });

    expect(report.gain).toBeGreaterThan(0.22);
    expect(report.gain).toBeLessThan(0.28);
    expect(report.counts.noClick / report.pulses).toBeGreaterThan(0.47);
    expect(report.counts.noClick / report.pulses).toBeLessThan(0.53);
  });

  it('turns misalignment into a matching QBER', () => {
    const misalignmentRad = 0.2;
    const model = { ...IDEAL, misalignmentRad };
    const report = runBb84({ pulses: 40000, seed: 5, model });
    const expected = Math.sin(misalignmentRad) ** 2;

    expect(Math.abs(report.sifted.qber - expected)).toBeLessThan(0.015);
  });

  it('is reproducible for a fixed seed and differs across seeds', () => {
    const options = { pulses: 4000, seed: 99, model: { ...IDEAL, detectorEfficiency: 0.8 } };
    const first = runBb84(options);
    const second = runBb84(options);
    const other = runBb84({ ...options, seed: 100 });

    expect(second).toEqual(first);
    expect(other.counts).not.toEqual(first.counts);
  });

  it('models dark counts as clicks without photons and discards double clicks', () => {
    const model = { ...IDEAL, transmission: 0, darkCountProbability: 0.05 };
    const report = runBb84({ pulses: 20000, seed: 3, model });

    expect(report.counts.singleClick).toBeGreaterThan(0);
    expect(report.counts.doubleClick).toBeGreaterThan(0);
    expect(report.counts.noClick / report.pulses).toBeCloseTo(0.95 ** 4, 1);
    expect(Math.abs(report.sifted.qber - 0.5)).toBeLessThan(0.1);
  });

  it('rejects out-of-range inputs', () => {
    expect(() => runBb84({ pulses: 0, seed: 1, model: IDEAL })).toThrow(/pulses/);
    expect(() => runBb84({ pulses: 100001, seed: 1, model: IDEAL })).toThrow(/pulses/);
    expect(() => runBb84({
      pulses: 10, seed: 1, model: { ...IDEAL, transmission: 1.5 },
    })).toThrow(/transmission/);
  });
});

describe('Optical hash and cache', () => {
  it('changes when optics change', () => {
    const base = opticalHash(IDEAL);
    expect(opticalHash({ ...IDEAL })).toBe(base);
    expect(opticalHash({ ...IDEAL, transmission: 0.9 })).not.toBe(base);
    expect(opticalHash({ ...IDEAL, misalignmentRad: 0.01 })).not.toBe(base);
  });

  it('caches by optical hash and seed, invalidating on optics change', () => {
    const runner = new Bb84Runner();
    const options = { pulses: 1000, seed: 42, model: { ...IDEAL, detectorEfficiency: 0.9 } };

    const first = runner.run(options);
    const second = runner.run(options);
    expect(second).toEqual(first);
    expect(runner.getCacheStats()).toEqual({ hits: 1, misses: 1, size: 1 });

    const newSeed = runner.run({ ...options, seed: 43 });
    expect(newSeed.opticalHash).toBe(first.opticalHash);
    expect(runner.getCacheStats()).toEqual({ hits: 1, misses: 2, size: 2 });

    const changedOptics = runner.run({
      ...options,
      model: { ...options.model, transmission: 0.8 },
    });
    expect(changedOptics.opticalHash).not.toBe(first.opticalHash);
    expect(runner.getCacheStats()).toEqual({ hits: 1, misses: 3, size: 3 });
  });

  it('bounds the cache size', () => {
    const runner = new Bb84Runner(2);
    for (let seed = 0; seed < 5; seed++) {
      runner.run({ pulses: 10, seed, model: IDEAL });
    }
    expect(runner.getCacheStats().size).toBe(2);
  });
});

describe('Baseline scenario', () => {
  it('loads and runs the checked-in BB84 scenario', () => {
    const path = resolve(process.cwd(), 'scenarios/bb84.json');
    const scenario = JSON.parse(readFileSync(path, 'utf-8'));

    expect(scenario.schemaVersion).toBe(1);
    expect(scenario.name).toBe('bb84-baseline');

    const report = runBb84({
      pulses: scenario.pulses,
      seed: scenario.seed,
      model: scenario.model,
    });

    expect(report.pulses).toBe(scenario.pulses);
    expect(report.sifted.length).toBeGreaterThan(0);
    expect(report.sifted.qber).toBeGreaterThan(0);
    expect(report.sifted.qber).toBeLessThan(0.05);
    expect(report.gain).toBeGreaterThan(0.4);
  });
});
