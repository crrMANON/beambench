/**
 * Trace physics contract tests with explicit expected values (not vacuous checks).
 */
import { describe, it, expect } from 'vitest';
import { computeTrace, TraceSceneInput, TraceElementInput } from '../../src/physics/trace';

const MOUNT = {
  pivotPoint: [0, 0, 0] as [number, number, number],
  axes: {
    tiltX: { min: -0.1, max: 0.1 },
    tiltY: { min: -0.1, max: 0.1 },
    rotationZ: { min: 0, max: Math.PI },
  },
};

function element(
  kind: TraceElementInput['kind'],
  position: [number, number, number],
  props: Record<string, unknown> = {},
  orientation: [number, number, number, number] = [0, 0, 0, 1]
): TraceElementInput {
  return {
    uuid: crypto.randomUUID(),
    kind,
    active: true,
    pose: { position, orientation },
    props,
  };
}

function source(props: Record<string, unknown> = {}): TraceElementInput {
  return element('source', [0, 0.1, 0], {
    wavelength_nm: 532,
    forward_cm: 100,
    backward_cm: 0,
    polPreset: 'H',
    intensity_rel: 1,
    ...props,
  });
}

function scene(...elements: TraceElementInput[]): TraceSceneInput {
  return { revision: 1, elements };
}

describe('Trace physics', () => {
  it('reflects a beam and records mirror loss', () => {
    const mirror = element('mirror', [0, 0.1, 0.05], { reflectivity: 0.99 });
    const result = computeTrace(scene(source(), mirror));

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].direction).toEqual([0, 0, 1]);
    expect(result.segments[1].direction[2]).toBeCloseTo(-1, 12);
    expect(result.segments[1].powerRatio).toBeCloseTo(0.99, 12);

    expect(result.losses).toHaveLength(1);
    expect(result.losses[0].cause).toBe('reflection_loss');
    expect(result.losses[0].powerLost).toBeCloseTo(0.01, 12);
    expect(result.summary.energyConserved).toBe(true);
  });

  it('detects a centered beam with finite detector efficiency', () => {
    const detector = element('detector', [0, 0.1, 0.1], {
      apertureRadius_m: 0.01,
      efficiency: 0.9,
    });
    const result = computeTrace(scene(source(), detector));

    expect(result.arrivals).toHaveLength(1);
    expect(result.arrivals[0].incidentPower).toBeCloseTo(1, 12);
    expect(result.arrivals[0].detectedPower).toBeCloseTo(0.9, 12);
    expect(result.arrivals[0].truncationReason).toBeUndefined();
    expect(result.summary.energyConserved).toBe(true);
  });

  it('marks off-axis detector hits as aperture cuts', () => {
    const detector = element('detector', [0.1, 0.1, 0.1], {
      apertureRadius_m: 0.01,
      efficiency: 1,
    });
    const result = computeTrace(scene(source(), detector));

    expect(result.arrivals).toHaveLength(1);
    expect(result.arrivals[0].detectedPower).toBe(0);
    expect(result.arrivals[0].truncationReason).toBe('OUTSIDE_APERTURE');
    expect(result.losses.some((l) => l.cause === 'aperture_cut')).toBe(true);
    expect(result.summary.energyConserved).toBe(true);
  });

  it('splits a 50/50 beam splitter into two balanced branches', () => {
    const bs = element('bs', [0, 0.1, 0.1], { reflectivity: 0.5 });
    const result = computeTrace(scene(source(), bs));

    expect(result.segments).toHaveLength(3);
    const terminalPowers = result.segments.slice(1).map((s) => s.powerRatio);
    expect(terminalPowers).toHaveLength(2);
    expect(terminalPowers[0]).toBeCloseTo(0.5, 12);
    expect(terminalPowers[1]).toBeCloseTo(0.5, 12);
    expect(result.summary.energyConserved).toBe(true);
  });

  it('extinguishes a beam at a crossed polarizer and accounts for the loss', () => {
    const polarizer = element('polarizer', [0, 0.1, 0.1], { axisAngleDeg: 90 });
    const result = computeTrace(scene(source(), polarizer));

    expect(result.losses[0].powerLost).toBeCloseTo(1, 12);
    expect(result.truncated.some((t) => t.reason === 'AMP_CUTOFF')).toBe(true);
    expect(result.summary.energyConserved).toBe(true);
  });

  it('never creates implicit sources', () => {
    const result = computeTrace(scene(element('mirror', [0, 0.1, 0.1])));
    expect(result.segments).toHaveLength(0);
    expect(result.summary.totalPower).toBe(0);
    expect(result.summary.energyConserved).toBe(true);
  });

  it('stops a cavity at maxSteps and reports truncation', () => {
    const m1 = element('mirror', [0, 0.1, 0.05], { reflectivity: 1 });
    const m2 = element('mirror', [0, 0.1, -0.05], { reflectivity: 1 });
    const result = computeTrace(scene(source(), m1, m2), { maxSteps: 10 });

    expect(result.truncated.some((t) => t.reason === 'MAX_STEPS_EXCEEDED')).toBe(true);
    expect(result.summary.energyConserved).toBe(true);
  });

  it('is deterministic for the same scene and options', () => {
    const input = scene(source(), element('mirror', [0, 0.1, 0.05]));
    expect(computeTrace(input)).toEqual(computeTrace(input));
  });

  it('returns an empty result for invalid scenes', () => {
    for (const invalid of [null, undefined, {} as TraceSceneInput]) {
      const result = computeTrace(invalid);
      expect(result.segments).toHaveLength(0);
      expect(result.revision).toBe(0);
      expect(result.summary.energyConserved).toBe(true);
    }
  });
});
