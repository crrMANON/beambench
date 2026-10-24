/**
 * BB-06 measurement tests with analytic expectations for a circular Gaussian.
 */
import { describe, it, expect } from 'vitest';
import {
  gaussianApertureFraction,
  measure,
  measureReferencePlane,
} from '../../src/physics/measurement';
import { computeTrace, TraceElementInput, TraceSceneInput } from '../../src/physics/trace';

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
  props: Record<string, unknown> = {}
): TraceElementInput {
  return {
    uuid: crypto.randomUUID(),
    kind,
    active: true,
    pose: { position, orientation: [0, 0, 0, 1] },
    props,
  };
}

function source(waist_um = 5000): TraceElementInput {
  return element('source', [0, 0.1, 0], {
    wavelength_nm: 532,
    forward_cm: 100,
    backward_cm: 0,
    polPreset: 'H',
    intensity_rel: 1,
    waist_um,
  });
}

function scene(...elements: TraceElementInput[]): TraceSceneInput {
  return { revision: 3, elements };
}

describe('Gaussian aperture integration', () => {
  const w = 0.005;

  it('matches the analytic centred result', () => {
    const aperture = w / Math.SQRT2; // 1 - exp(-1)
    expect(gaussianApertureFraction(0, aperture, w)).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  it('approaches zero when the beam is far off-axis', () => {
    const fraction = gaussianApertureFraction(0.1, 0.001, w);
    expect(fraction).toBeLessThan(1e-9);
  });

  it('is monotonic in aperture radius', () => {
    const small = gaussianApertureFraction(0.002, 0.001, w);
    const large = gaussianApertureFraction(0.002, 0.004, w);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(1);
  });

  it('numerical off-axis integration agrees with a shifted analytic check', () => {
    // For offset=0 the numerical branch must reproduce the analytic branch.
    const analytic = gaussianApertureFraction(0, 0.003, w);
    const numeric = gaussianApertureFraction(1e-9, 0.003, w);
    expect(numeric).toBeCloseTo(analytic, 3);
  });
});

describe('Detector measurement', () => {
  it('reports incident/detected power, spot and radius for a centred beam', () => {
    const src = source();
    const detector = element('detector', [0, 0.1, 0.2], {
      apertureRadius_m: 0.005,
      efficiency: 0.9,
    });
    const trace = computeTrace(scene(src, detector));
    const observation = measure(trace, [src, detector]);

    expect(observation.revision).toBe(3);
    expect(observation.traceStatus).toBe('OK');
    expect(observation.detectors).toHaveLength(1);

    const reading = observation.detectors[0];
    expect(reading.hit).toBe(true);
    expect(reading.incidentPower).toBeCloseTo(1, 12);
    // detected / total input (aperture truncation + detector efficiency)
    expect(reading.powerRatio).toBeCloseTo((1 - Math.exp(-2)) * 0.9, 2);
    // aperture = w: 1 - exp(-2) = 0.8647, times 0.9 efficiency
    expect(reading.receivedRatio).toBeCloseTo((1 - Math.exp(-2)) * 0.9, 2);
    expect(reading.spot?.x).toBeCloseTo(0, 12);
    expect(reading.spot?.y).toBeCloseTo(0, 12);
    expect(reading.beamRadius_m).toBeCloseTo(0.005, 12);
    expect(reading.direction).toEqual([0, 0, 1]);
  });

  it('flags an off-axis detector with no detected power', () => {
    const src = source();
    const detector = element('detector', [0.1, 0.1, 0.2], {
      apertureRadius_m: 0.001,
      efficiency: 1,
    });
    const trace = computeTrace(scene(src, detector));
    const reading = measure(trace, [src, detector]).detectors[0];

    expect(reading.hit).toBe(false);
    expect(reading.detectedPower).toBeLessThan(1e-9);
    expect(reading.reason).toBe('OUTSIDE_APERTURE');
    // beam hits 0.1 m on the -X side of the detector centre
    expect(reading.spot?.x).toBeCloseTo(-0.1, 6);
  });

  it('flags a detector that receives no beam', () => {
    const src = source();
    const detector = element('detector', [0, 0.1, -0.2], {
      apertureRadius_m: 0.01,
      efficiency: 1,
    });
    const trace = computeTrace(scene(src, detector));
    const reading = measure(trace, [src, detector]).detectors[0];

    expect(reading.hit).toBe(false);
    expect(reading.reason).toBe('NO_BEAM');
    expect(reading.spot).toBeNull();
  });

  it('scales detected power with aperture ratio and efficiency', () => {
    const src = source();
    const detector = element('detector', [0, 0.1, 0.2], {
      apertureRadius_m: 0.0025,
      efficiency: 0.5,
    });
    const trace = computeTrace(scene(src, detector));
    const reading = measure(trace, [src, detector]).detectors[0];
    // 1 - exp(-2 * 0.25) = 0.3935, times 0.5
    expect(reading.receivedRatio).toBeCloseTo((1 - Math.exp(-0.5)) * 0.5, 2);
  });

  it('does not modify the trace result', () => {
    const src = source();
    const detector = element('detector', [0, 0.1, 0.2], {
      apertureRadius_m: 0.005,
      efficiency: 1,
    });
    const trace = computeTrace(scene(src, detector));
    const before = JSON.parse(JSON.stringify(trace));

    measure(trace, [src, detector]);
    measureReferencePlane(trace, {
      uuid: 'plane',
      pose: { position: [0, 0.1, 0.1], orientation: [0, 0, 0, 1] },
    });

    expect(trace).toEqual(before);
  });
});

describe('Reference plane measurement', () => {
  it('reports intersections without absorbing power', () => {
    const src = source();
    const trace = computeTrace(scene(src));

    const before = JSON.parse(JSON.stringify(trace));
    const measurement = measureReferencePlane(trace, {
      uuid: 'plane-1',
      pose: { position: [0, 0.1, 0.25], orientation: [0, 0, 0, 1] },
    });

    expect(measurement.intersections).toHaveLength(1);
    expect(measurement.intersections[0].distance_m).toBeCloseTo(0.25, 12);
    expect(measurement.intersections[0].local.x).toBeCloseTo(0, 12);
    expect(measurement.intersections[0].powerRatio).toBeCloseTo(1, 12);
    expect(measurement.totalPower).toBeCloseTo(1, 12);
    expect(trace).toEqual(before);
  });

  it('ignores planes behind the beam', () => {
    const src = source();
    const trace = computeTrace(scene(src));
    const measurement = measureReferencePlane(trace, {
      uuid: 'plane-behind',
      pose: { position: [0, 0.1, -0.25], orientation: [0, 0, 0, 1] },
    });
    expect(measurement.intersections).toHaveLength(0);
    expect(measurement.totalPower).toBe(0);
  });

  it('respects segment length so a plane past a mirror is not double-counted', () => {
    const src = source();
    const mirror = element('mirror', [0, 0.1, 0.05], { reflectivity: 1 });
    const trace = computeTrace(scene(src, mirror));

    const beforeMirror = measureReferencePlane(trace, {
      uuid: 'before',
      pose: { position: [0, 0.1, 0.025], orientation: [0, 0, 0, 1] },
    });
    // Both the forward segment and the reflected segment cross this plane.
    expect(beforeMirror.intersections).toHaveLength(2);

    // A plane beyond the mirror is not crossed by the forward segment
    // (length 0.05), and the reflected segment travels away from it.
    const afterMirror = measureReferencePlane(trace, {
      uuid: 'after',
      pose: { position: [0, 0.1, 0.075], orientation: [0, 0, 0, 1] },
    });
    expect(afterMirror.intersections).toHaveLength(0);
  });
});
