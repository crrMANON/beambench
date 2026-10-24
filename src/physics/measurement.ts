/**
 * BB-06 Measurement Module
 *
 * Quantifies what a detector or a non-absorbing reference plane receives from a
 * TraceResult without mutating it (PLAN §3.1/§3.3):
 * - Detector power ratio and received ratio (finite circular aperture)
 * - Gaussian spot position in the detector's local frame
 * - Incidence direction and 1/e² radius
 * - Explicit reasons for no-beam / aperture cuts
 *
 * Model scope: the spot is modelled as a circular Gaussian with 1/e² radius w.
 * The aperture is a circle in the element plane; oblique-incidence ellipse
 * projection is not applied and is reported as a model limitation.
 */

import {
  DirectionTuple,
  PositionTuple,
  QuaternionTuple,
  TraceElementInput,
  TraceResult,
  TraceSegment,
} from './trace';

export interface DetectorMeasurement {
  uuid: string;
  revision: number;
  hit: boolean;
  incidentPower: number;
  detectedPower: number;
  /** detected power / scene total input power */
  powerRatio: number;
  /** detected power / incident power on this detector */
  receivedRatio: number;
  spot: { x: number; y: number } | null;
  direction: DirectionTuple | null;
  beamRadius_m: number | null;
  truncationReason?: string;
  reason?: 'NO_BEAM' | 'OUTSIDE_APERTURE' | 'TRACE_FAILED';
}

export interface MeasurementObservation {
  revision: number;
  detectors: DetectorMeasurement[];
  traceStatus: 'OK' | 'TRACE_FAILED';
  modelLimits: string[];
}

export interface PlaneIntersection {
  segmentId: string;
  position: PositionTuple;
  local: { x: number; y: number };
  distance_m: number;
  powerRatio: number;
  direction: DirectionTuple;
  beamRadius_m: number;
}

export interface PlaneMeasurement {
  uuid: string;
  revision: number;
  intersections: PlaneIntersection[];
  totalPower: number;
}

export interface ReferencePlaneSpec {
  uuid: string;
  pose: {
    position: PositionTuple;
    orientation: QuaternionTuple;
  };
}

/**
 * Fraction of a circular Gaussian beam transmitted by a circular aperture.
 *
 * @param offset_m distance from the aperture centre to the beam centre
 * @param aperture_m aperture radius
 * @param radius_m 1/e² beam radius
 */
export function gaussianApertureFraction(
  offset_m: number,
  aperture_m: number,
  radius_m: number
): number {
  if (aperture_m <= 0 || radius_m <= 0) return 0;

  // Analytic solution for a centred beam.
  if (Math.abs(offset_m) < 1e-15) {
    return 1 - Math.exp((-2 * aperture_m * aperture_m) / (radius_m * radius_m));
  }

  // Off-centre beams need numerical integration over the aperture disc.
  const radialSteps = 48;
  const angularSteps = 96;
  const dr = aperture_m / radialSteps;
  const dTheta = (2 * Math.PI) / angularSteps;

  let integral = 0;
  for (let i = 0; i < radialSteps; i++) {
    const r = (i + 0.5) * dr;
    for (let j = 0; j < angularSteps; j++) {
      const theta = (j + 0.5) * dTheta;
      const x = r * Math.cos(theta) - offset_m;
      const y = r * Math.sin(theta);
      integral += Math.exp((-2 * (x * x + y * y)) / (radius_m * radius_m)) * r;
    }
  }

  // Gaussian power normalisation: ∫ exp(-2r²/w²) dA = π w² / 2.
  return integral * dr * dTheta / (Math.PI * radius_m * radius_m / 2);
}

/** Measure all detectors in the scene against a trace result. */
export function measure(
  trace: TraceResult,
  elements: readonly TraceElementInput[]
): MeasurementObservation {
  const detectors = elements.filter(
    (el) => el && el.kind === 'detector'
  );

  const segmentById = new Map<string, TraceSegment>(
    trace.segments.map((segment) => [segment.segmentId, segment])
  );

  const results: DetectorMeasurement[] = detectors.map((detector) => {
    const arrivals = trace.arrivals.filter(
      (arrival) =>
        arrival.destinationType === 'detector' &&
        arrival.destinationId === detector.uuid
    );

    const aperture = numberOf(detector.props.apertureRadius_m, 0.01);
    const efficiency = clamp01(numberOf(detector.props.efficiency, 1));

    if (arrivals.length === 0) {
      return {
        uuid: detector.uuid,
        revision: trace.revision,
        hit: false,
        incidentPower: 0,
        detectedPower: 0,
        powerRatio: 0,
        receivedRatio: 0,
        spot: null,
        direction: null,
        beamRadius_m: null,
        reason: 'NO_BEAM',
      };
    }

    let incidentPower = 0;
    let detectedPower = 0;
    let beamRadius = 0;
    let dominantArrival = arrivals[0];
    let dominantPower = -1;
    let truncationReason: string | undefined;

    for (const arrival of arrivals) {
      const segment = segmentById.get(arrival.segmentId);
      const radius = segment?.beamRadius_m ?? 0;
      const { x, y } = localCoordinates(arrival.position, detector);
      const offset = Math.hypot(x, y);
      const fraction = gaussianApertureFraction(offset, aperture, radius);

      incidentPower += arrival.incidentPower;
      detectedPower += arrival.incidentPower * fraction * efficiency;
      beamRadius = Math.max(beamRadius, radius);

      if (arrival.incidentPower > dominantPower) {
        dominantPower = arrival.incidentPower;
        dominantArrival = arrival;
      }
      if (arrival.truncationReason) truncationReason = arrival.truncationReason;
    }

    const spot = localCoordinates(dominantArrival.position, detector);
    const segment = segmentById.get(dominantArrival.segmentId);
    const hit = detectedPower > 1e-15;

    return {
      uuid: detector.uuid,
      revision: trace.revision,
      hit,
      incidentPower,
      detectedPower,
      powerRatio: trace.summary.totalPower > 0
        ? detectedPower / trace.summary.totalPower
        : 0,
      receivedRatio: incidentPower > 0 ? detectedPower / incidentPower : 0,
      spot,
      direction: segment ? [...segment.direction] as DirectionTuple : null,
      beamRadius_m: beamRadius > 0 ? beamRadius : null,
      truncationReason: hit ? undefined : (truncationReason ?? 'OUTSIDE_APERTURE'),
      reason: hit ? undefined : 'OUTSIDE_APERTURE',
    };
  });

  const modelLimits = [
    ...trace.warnings.map((warning) => warning.message),
    'Detector spot is modelled as a circular Gaussian; oblique-incidence ellipse projection is not applied',
  ];

  return {
    revision: trace.revision,
    detectors: results,
    traceStatus: 'OK',
    modelLimits,
  };
}

/**
 * Intersect every trace segment with a non-absorbing reference plane.
 * Does not modify the trace; safe to call for diagnostics alongside detectors.
 */
export function measureReferencePlane(
  trace: TraceResult,
  plane: ReferencePlaneSpec
): PlaneMeasurement {
  const normal = surfaceNormal(plane.pose.orientation);
  const intersections: PlaneIntersection[] = [];
  let totalPower = 0;

  for (const segment of trace.segments) {
    const denom = dot(segment.direction, normal);
    if (Math.abs(denom) < 1e-12) continue;

    const delta: PositionTuple = [
      plane.pose.position[0] - segment.origin[0],
      plane.pose.position[1] - segment.origin[1],
      plane.pose.position[2] - segment.origin[2],
    ];
    const distance = dot(delta, normal) / denom;

    if (distance <= 1e-9) continue;
    if (segment.length_m !== undefined && distance > segment.length_m + 1e-9) continue;

    const position = addScaled(segment.origin, segment.direction, distance);
    const { x, y } = localCoordinates(position, plane);

    intersections.push({
      segmentId: segment.segmentId,
      position,
      local: { x, y },
      distance_m: distance,
      powerRatio: segment.powerRatio,
      direction: [...segment.direction] as DirectionTuple,
      beamRadius_m: segment.beamRadius_m,
    });
    totalPower += segment.powerRatio;
  }

  return {
    uuid: plane.uuid,
    revision: trace.revision,
    intersections,
    totalPower,
  };
}

/** Convert a world point into the element's local (x, y) plane coordinates. */
function localCoordinates(
  position: PositionTuple,
  element: { pose: { position: PositionTuple; orientation: QuaternionTuple } }
): { x: number; y: number } {
  const normal = surfaceNormal(element.pose.orientation);
  const up: DirectionTuple = [0, 1, 0];
  let tangent = cross(up, normal);
  if (Math.hypot(...tangent) < 1e-12) {
    tangent = cross([1, 0, 0], normal);
  }
  const localX = normalize(tangent);
  const localY = normalize(cross(normal, localX));

  const delta: PositionTuple = [
    position[0] - element.pose.position[0],
    position[1] - element.pose.position[1],
    position[2] - element.pose.position[2],
  ];

  return { x: dot(delta, localX), y: dot(delta, localY) };
}

function surfaceNormal(orientation: QuaternionTuple): DirectionTuple {
  return normalize(rotateVector([0, 0, 1], orientation));
}

function rotateVector(v: number[], q: QuaternionTuple): number[] {
  const [x, y, z, w] = q;
  const rx =
    v[0] * (1 - 2 * (y * y + z * z)) + v[1] * (2 * x * y - 2 * w * z) +
    v[2] * (2 * x * z + 2 * w * y);
  const ry =
    v[0] * (2 * x * y + 2 * w * z) + v[1] * (1 - 2 * (x * x + z * z)) +
    v[2] * (2 * y * z - 2 * w * x);
  const rz =
    v[0] * (2 * x * z - 2 * w * y) + v[1] * (2 * y * z + 2 * w * x) +
    v[2] * (1 - 2 * (x * x + y * y));
  return [rx, ry, rz];
}

function normalize(v: number[]): DirectionTuple {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-20) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: number[], b: number[]): DirectionTuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function addScaled(
  origin: PositionTuple,
  direction: DirectionTuple,
  scale: number
): PositionTuple {
  return [
    origin[0] + direction[0] * scale,
    origin[1] + direction[1] * scale,
    origin[2] + direction[2] * scale,
  ];
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
