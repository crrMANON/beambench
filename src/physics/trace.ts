/**
 * BB-04 TraceResult Output Module
 *
 * Provides stable, complete beam propagation results per PLAN §3.1/3.3:
 * - No implicit source generation (only explicit active sources propagate)
 * - All branches counted in the power budget
 * - Truncated/lost branches explicitly marked
 * - Deterministic output for the same scene revision
 * - No NaN/Infinity values (invalid input yields an empty trace)
 *
 * Model scope (v1): beams propagate through infinite element planes. Mirrors
 * reflect about the element normal, beam splitters split by reflectivity,
 * polarizers project the Jones vector, and detectors use a finite circular
 * aperture. Thin-lens ABCD q-propagation is not applied yet; this limitation is
 * reported as a warning instead of being silently ignored.
 */

// === Core Data Structures ===

export type PositionTuple = [number, number, number];
export type DirectionTuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];

export interface JonesVector {
  Ex: { re: number; im: number };
  Ey: { re: number; im: number };
}

/** ABCD matrix stored as complex components (kept for future q-propagation) */
export interface ComplexABCD {
  A: { re: number; im: number };
  B: { re: number; im: number };
  C: { re: number; im: number };
  D: { re: number; im: number };
}

export interface TraceSegment {
  segmentId: string;
  sourceId: string;
  branchId: number;
  origin: PositionTuple;
  direction: DirectionTuple;
  jones: JonesVector;
  q: ComplexABCD;
  powerRatio: number;
  /** 1/e^2 intensity radius used by measurement (metres) */
  beamRadius_m: number;
  /** Geometric length to the next interaction; absent for unbounded segments */
  length_m?: number;
}

export interface TraceArrival {
  arrivalId: string;
  segmentId: string;
  destinationType: 'detector' | 'beamDump' | 'surface';
  destinationId?: string;
  position: PositionTuple;
  localBasisUp: DirectionTuple;
  incidentPower: number;
  absorbedPower?: number;
  detectedPower?: number;
  truncationReason?: string;
}

export interface TraceLoss {
  lossId: string;
  segmentId: string;
  cause: 'absorption' | 'reflection_loss' | 'transmission_loss' | 'aperture_cut' | 'cutoff_threshold';
  position: PositionTuple;
  powerLost: number;
}

export interface TruncatedBranch {
  segmentId: string;
  reason: 'AMP_CUTOFF' | 'MAX_BEAMS_EXCEEDED' | 'MAX_SEGMENTS_EXCEEDED' |
    'MAX_STEPS_EXCEEDED' | 'ENERGY_BELOW_THRESHOLD';
  thresholdValue?: number;
  expectedPower?: number;
}

export interface TraceWarning {
  warningId: string;
  code: 'DISJOINT_ELEMENTS' | 'NON_PLANAR_BASIS' | 'OVERLAPPING_COMPONENTS' | 'MODEL_LIMITATION';
  message: string;
  affectedSegments?: string[];
}

export interface TraceResult {
  revision: number;
  engineCommit?: string;
  segments: TraceSegment[];
  arrivals: TraceArrival[];
  losses: TraceLoss[];
  truncated: TruncatedBranch[];
  warnings: TraceWarning[];
  summary: {
    totalSegments: number;
    totalArrivals: number;
    totalPower: number;
    energyConserved: boolean;
  };
}

// === Input types (structural subset of SceneV1) ===

export type ElementKind =
  | 'source' | 'raysSource' | 'lens' | 'thickLens'
  | 'mirror' | 'polarizer' | 'waveplate' | 'faraday'
  | 'pbs' | 'bs' | 'iris' | 'detector' | 'beamDump' | 'grating';

export interface TraceElementInput {
  uuid: string;
  kind: ElementKind;
  active: boolean;
  pose: {
    position: PositionTuple;
    orientation: QuaternionTuple;
  };
  props: Record<string, unknown>;
}

export interface TraceSceneInput {
  revision?: number;
  elements: TraceElementInput[];
}

// === Constants per PLAN §3.3 ===

export const MAX_STEPS_DEFAULT = 200;
export const AMP_CUTOFF = 0.02;
export const MAX_SEGMENTS_DEFAULT = 600;
export const POWER_TOL = 1e-8;
export const ENGINE_COMMIT = 'bb04-tracer-v1';

// === Main Trace Function ===

export interface TraceOptions {
  maxSteps?: number;
  ampCutoff?: number;
  maxSegments?: number;
  includeWarnings?: boolean;
}

interface Beam {
  sourceId: string;
  branchId: number;
  origin: PositionTuple;
  direction: DirectionTuple;
  jones: JonesVector;
  power: number;
  depth: number;
  beamRadius_m: number;
  lastElementId?: string;
}

interface TraceContext {
  segments: TraceSegment[];
  arrivals: TraceArrival[];
  losses: TraceLoss[];
  truncated: TruncatedBranch[];
  warnings: TraceWarning[];
  segmentCounter: number;
  arrivalCounter: number;
  lossCounter: number;
}

/** Compute a deterministic trace for a scene revision. */
export function computeTrace(
  scene: TraceSceneInput | null | undefined,
  options: TraceOptions = {}
): TraceResult {
  const {
    maxSteps = MAX_STEPS_DEFAULT,
    ampCutoff = AMP_CUTOFF,
    maxSegments = MAX_SEGMENTS_DEFAULT,
    includeWarnings = true,
  } = options;

  if (!scene || !Array.isArray(scene.elements)) {
    return emptyTraceResult(scene?.revision ?? 0);
  }

  const revision = Number.isFinite(scene.revision) ? (scene.revision as number) : 0;
  const elements = (scene.elements as TraceElementInput[]).filter(
    (el) => el && el.active
  );

  const ctx: TraceContext = {
    segments: [],
    arrivals: [],
    losses: [],
    truncated: [],
    warnings: [],
    segmentCounter: 0,
    arrivalCounter: 0,
    lossCounter: 0,
  };

  const sources = elements.filter(
    (el) => el.kind === 'source' || el.kind === 'raysSource'
  );

  // Build initial branches only from explicit sources.
  const queue: Beam[] = [];
  let branchCounter = 0;
  for (const source of sources) {
    const forwardCm = numberOf(source.props.forward_cm, 0);
    const backwardCm = numberOf(source.props.backward_cm, 0);
    const power = clamp01(numberOf(source.props.intensity_rel, 1));

    const directions: DirectionTuple[] = [];
    if (forwardCm > 0) directions.push([0, 0, 1]);
    if (backwardCm > 0) directions.push([0, 0, -1]);

    for (const localDir of directions) {
      const direction = normalizeDirection(
        rotateVector(localDir, source.pose.orientation)
      );
      queue.push({
        sourceId: source.uuid,
        branchId: branchCounter++,
        origin: [...source.pose.position] as PositionTuple,
        direction,
        jones: jonesFromPreset(source.props.polPreset),
        power,
        depth: 0,
        beamRadius_m: numberOf(source.props.waist_um, 500) * 1e-6,
      });
    }
  }

  const totalInputPower = queue.reduce((sum, beam) => sum + beam.power, 0);
  let freeSpacePower = 0; // power that left the scene without an interaction
  let steps = 0;
  let limitReached: TruncatedBranch['reason'] | null = null;

  while (queue.length > 0) {
    if (steps >= maxSteps) {
      limitReached = 'MAX_STEPS_EXCEEDED';
      break;
    }
    if (ctx.segments.length >= maxSegments) {
      limitReached = 'MAX_SEGMENTS_EXCEEDED';
      break;
    }

    const beam = queue.shift() as Beam;
    steps++;

    if (beam.power < ampCutoff) {
      ctx.truncated.push({
        segmentId: `seg-${ctx.segmentCounter}`,
        reason: 'AMP_CUTOFF',
        thresholdValue: ampCutoff,
        expectedPower: beam.power,
      });
      continue;
    }

    const hit = nearestHit(beam, elements);
    if (!hit) {
      freeSpacePower += beam.power;
      // Record the free-space segment for visualization/audit.
      pushSegment(ctx, beam);
      continue;
    }

    const { element, distance } = hit;
    const segmentId = pushSegment(ctx, {
      ...beam,
      origin: beam.origin,
      direction: beam.direction,
    }, distance);
    const position = addVectors(beam.origin, scaleVector(beam.direction, distance));

    let nextBeams: Beam[] = [];

    switch (element.kind) {
      case 'detector': {
        const offset = perpendicularOffset(position, element);
        const aperture = numberOf(element.props.apertureRadius_m, 0.01);
        const efficiency = clamp01(numberOf(element.props.efficiency, 1));
        const hitsAperture = offset <= aperture;
        const incident = hitsAperture ? beam.power * efficiency : 0;

        ctx.arrivals.push({
          arrivalId: `arr-${ctx.arrivalCounter++}`,
          segmentId,
          destinationType: 'detector',
          destinationId: element.uuid,
          position,
          localBasisUp: [0, 1, 0],
          incidentPower: beam.power,
          detectedPower: incident,
          truncationReason: hitsAperture ? undefined : 'OUTSIDE_APERTURE',
        });

        if (hitsAperture && incident < beam.power) {
          recordLoss(ctx, segmentId, 'absorption', position, beam.power - incident);
        }
        if (!hitsAperture) {
          recordLoss(ctx, segmentId, 'aperture_cut', position, beam.power);
        }
        break;
      }

      case 'beamDump':
        ctx.arrivals.push({
          arrivalId: `arr-${ctx.arrivalCounter++}`,
          segmentId,
          destinationType: 'beamDump',
          destinationId: element.uuid,
          position,
          localBasisUp: [0, 1, 0],
          incidentPower: beam.power,
          absorbedPower: beam.power,
        });
        break;

      case 'mirror': {
        const normal = surfaceNormal(element);
        const reflectivity = clamp01(numberOf(element.props.reflectivity, 0.99));
        const reflectedDir = reflect(beam.direction, normal);
        const nextPower = beam.power * reflectivity;
        recordLoss(ctx, segmentId, 'reflection_loss', position, beam.power - nextPower);
        nextBeams = [
          {
            ...beam,
            origin: position,
            direction: reflectedDir,
            power: nextPower,
            depth: beam.depth + 1,
            lastElementId: element.uuid,
          },
        ];
        break;
      }

      case 'bs':
      case 'pbs': {
        const normal = surfaceNormal(element);
        const reflectivity = clamp01(numberOf(element.props.reflectivity, 0.5));
        const reflectedPower = beam.power * reflectivity;
        const transmittedPower = beam.power - reflectedPower;

        nextBeams = [
          {
            ...beam,
            origin: position,
            direction: reflect(beam.direction, normal),
            power: reflectedPower,
            branchId: branchCounter++,
            depth: beam.depth + 1,
            lastElementId: element.uuid,
          },
          {
            ...beam,
            origin: position,
            direction: beam.direction,
            power: transmittedPower,
            branchId: branchCounter++,
            depth: beam.depth + 1,
            lastElementId: element.uuid,
          },
        ].filter((b) => b.power > 0);
        break;
      }

      case 'polarizer': {
        const axisDeg = numberOf(element.props.axisAngleDeg, 0);
        const projected = projectJones(beam.jones, axisDeg);
        const inputIntensity = jonesIntensity(beam.jones);
        const outputIntensity = jonesIntensity(projected);
        const ratio = inputIntensity > 0 ? outputIntensity / inputIntensity : 0;
        const nextPower = beam.power * ratio;
        recordLoss(ctx, segmentId, 'absorption', position, beam.power - nextPower);
        nextBeams = [
          {
            ...beam,
            origin: position,
            direction: beam.direction,
            jones: projected,
            power: nextPower,
            depth: beam.depth + 1,
            lastElementId: element.uuid,
          },
        ];
        break;
      }

      case 'lens':
      case 'thickLens':
      case 'waveplate':
      case 'faraday': {
        const transmission = beamTransmission(element);
        const nextPower = beam.power * transmission;
        if (transmission < 1) {
          recordLoss(ctx, segmentId, 'transmission_loss', position, beam.power - nextPower);
        }
        nextBeams = [
          {
            ...beam,
            origin: position,
            direction: beam.direction,
            power: nextPower,
            depth: beam.depth + 1,
            lastElementId: element.uuid,
          },
        ];
        break;
      }

      case 'iris': {
        const offset = perpendicularOffset(position, element);
        const radius = numberOf(element.props.radius_m, 0.01);
        if (offset > radius) {
          recordLoss(ctx, segmentId, 'aperture_cut', position, beam.power);
          } else {
          nextBeams = [
            {
              ...beam,
              origin: position,
              direction: beam.direction,
              depth: beam.depth + 1,
              lastElementId: element.uuid,
            },
          ];
        }
        break;
      }

      default: {
        // Unknown/unsupported passive element: pass through and report it.
        if (includeWarnings) {
          addWarningOnce(ctx, 'MODEL_LIMITATION',
            `Element "${element.kind}" is treated as transparent by the v1 tracer`);
        }
        nextBeams = [
          {
            ...beam,
            origin: position,
            direction: beam.direction,
            depth: beam.depth + 1,
            lastElementId: element.uuid,
          },
        ];
        break;
      }
    }

    for (const next of nextBeams) {
      if (!isFiniteBeam(next)) {
        ctx.truncated.push({
          segmentId,
          reason: 'ENERGY_BELOW_THRESHOLD',
          expectedPower: next.power,
        });
        continue;
      }
      if (next.power < ampCutoff) {
        ctx.truncated.push({
          segmentId,
          reason: 'AMP_CUTOFF',
          thresholdValue: ampCutoff,
          expectedPower: next.power,
        });
        continue;
      }
      if (ctx.segments.length + queue.length >= maxSegments) {
        ctx.truncated.push({
          segmentId,
          reason: 'MAX_SEGMENTS_EXCEEDED',
          thresholdValue: maxSegments,
          expectedPower: next.power,
        });
        continue;
      }
      queue.push(next);
    }
  }

  if (limitReached) {
    ctx.truncated.push({
      segmentId: `seg-${Math.max(0, ctx.segmentCounter - 1)}`,
      reason: limitReached,
      thresholdValue: limitReached === 'MAX_STEPS_EXCEEDED' ? maxSteps : maxSegments,
      expectedPower: queue.reduce((sum, beam) => sum + beam.power, 0),
    });
  }

  // Power closure: inputs = detected/absorbed + losses + free space + queued.
  const sinkPower =
    ctx.arrivals.reduce((sum, a) => sum + (a.detectedPower ?? a.absorbedPower ?? 0), 0) +
    freeSpacePower +
    queue.reduce((sum, beam) => sum + beam.power, 0);
  const lostPower = ctx.losses.reduce((sum, l) => sum + l.powerLost, 0);
  const accountedPower = sinkPower + lostPower;
  const energyConserved = totalInputPower === 0
    ? true
    : Math.abs(accountedPower - totalInputPower) <= POWER_TOL;

  if (includeWarnings) {
    addWarningOnce(ctx, 'MODEL_LIMITATION',
      'v1 tracer uses infinite element planes and does not apply thin-lens ABCD propagation');
  }

  return {
    revision,
    engineCommit: ENGINE_COMMIT,
    segments: ctx.segments,
    arrivals: ctx.arrivals,
    losses: ctx.losses,
    truncated: ctx.truncated,
    warnings: ctx.warnings,
    summary: {
      totalSegments: ctx.segments.length,
      totalArrivals: ctx.arrivals.length,
      totalPower: totalInputPower,
      energyConserved,
    },
  };
}

// === Beam helpers ===

function beamTransmission(element: TraceElementInput): number {
  const raw = element.props.transmission;
  return raw === undefined ? 0.99 : clamp01(numberOf(raw, 0.99));
}

function nearestHit(
  beam: Beam,
  elements: TraceElementInput[]
): { element: TraceElementInput; distance: number } | null {
  let nearest: { element: TraceElementInput; distance: number } | null = null;

  for (const element of elements) {
    if (element.uuid === beam.lastElementId) continue;
    if (element.kind === 'source' || element.kind === 'raysSource') continue;

    const distance = planeIntersection(beam.origin, beam.direction, element);
    if (distance !== null && distance > 1e-9 &&
        (nearest === null || distance < nearest.distance)) {
      nearest = { element, distance };
    }
  }

  return nearest;
}

/** Distance along the ray to the element plane, or null if it never hits. */
function planeIntersection(
  origin: PositionTuple,
  direction: DirectionTuple,
  element: TraceElementInput
): number | null {
  const normal = surfaceNormal(element);
  const denom = dot(direction, normal);
  if (Math.abs(denom) < 1e-12) return null;

  const delta: PositionTuple = [
    element.pose.position[0] - origin[0],
    element.pose.position[1] - origin[1],
    element.pose.position[2] - origin[2],
  ];
  const distance = dot(delta, normal) / denom;
  return distance > 0 ? distance : null;
}

/** Element surface normal in world space (local +Z rotated by orientation). */
function surfaceNormal(element: TraceElementInput): DirectionTuple {
  return normalizeDirection(rotateVector([0, 0, 1], element.pose.orientation));
}

/** Distance from the element center within its plane. */
function perpendicularOffset(position: PositionTuple, element: TraceElementInput): number {
  const delta: PositionTuple = [
    position[0] - element.pose.position[0],
    position[1] - element.pose.position[1],
    position[2] - element.pose.position[2],
  ];
  const normal = surfaceNormal(element);
  const along = dot(delta, normal);
  const planar = subtractVectors(delta, scaleVector(normal, along));
  return Math.sqrt(dot(planar, planar));
}

function pushSegment(ctx: TraceContext, beam: Beam, length_m?: number): string {
  const segmentId = `seg-${ctx.segmentCounter++}`;
  ctx.segments.push({
    segmentId,
    sourceId: beam.sourceId,
    branchId: beam.branchId,
    origin: [...beam.origin] as PositionTuple,
    direction: [...beam.direction] as DirectionTuple,
    jones: { Ex: { ...beam.jones.Ex }, Ey: { ...beam.jones.Ey } },
    q: identityAbcd(),
    powerRatio: beam.power,
    beamRadius_m: beam.beamRadius_m,
    length_m,
  });
  return segmentId;
}

function recordLoss(
  ctx: TraceContext,
  segmentId: string,
  cause: TraceLoss['cause'],
  position: PositionTuple,
  powerLost: number
): void {
  if (powerLost <= 1e-15) return;
  ctx.losses.push({
    lossId: `loss-${ctx.lossCounter++}`,
    segmentId,
    cause,
    position: [...position] as PositionTuple,
    powerLost,
  });
}

function addWarningOnce(
  ctx: TraceContext,
  code: TraceWarning['code'],
  message: string
): void {
  if (ctx.warnings.some((w) => w.code === code && w.message === message)) return;
  ctx.warnings.push({
    warningId: `warn-${ctx.warnings.length}`,
    code,
    message,
  });
}

function isFiniteBeam(beam: Beam): boolean {
  const values = [
    ...beam.origin,
    ...beam.direction,
    beam.power,
    beam.jones.Ex.re,
    beam.jones.Ex.im,
    beam.jones.Ey.re,
    beam.jones.Ey.im,
  ];
  return values.every((v) => Number.isFinite(v));
}

// === Vector / quaternion math ===

function normalizeDirection(v: number[]): DirectionTuple {
  const lenSq = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (lenSq < 1e-20) return [0, 0, 1];
  const len = Math.sqrt(lenSq);
  return [v[0] / len, v[1] / len, v[2] / len];
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

function reflect(direction: DirectionTuple, normal: DirectionTuple): DirectionTuple {
  const d = 2 * dot(direction, normal);
  return normalizeDirection([
    direction[0] - d * normal[0],
    direction[1] - d * normal[1],
    direction[2] - d * normal[2],
  ]);
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function scaleVector(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function addVectors(
  a: [number, number, number],
  b: [number, number, number]
): PositionTuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtractVectors(
  a: [number, number, number],
  b: [number, number, number]
): PositionTuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// === Jones helpers ===

function jonesFromPreset(preset: unknown): JonesVector {
  const value = typeof preset === 'string' ? preset.toUpperCase() : 'H';
  switch (value) {
    case 'V':
      return { Ex: { re: 0, im: 0 }, Ey: { re: 1, im: 0 } };
    case 'D':
      return {
        Ex: { re: 1 / Math.SQRT2, im: 0 },
        Ey: { re: 1 / Math.SQRT2, im: 0 },
      };
    case 'A':
      return {
        Ex: { re: 1 / Math.SQRT2, im: 0 },
        Ey: { re: -1 / Math.SQRT2, im: 0 },
      };
    case 'RL':
      return {
        Ex: { re: 1 / Math.SQRT2, im: 0 },
        Ey: { re: 0, im: -1 / Math.SQRT2 },
      };
    case 'R':
      return {
        Ex: { re: 1 / Math.SQRT2, im: 0 },
        Ey: { re: 0, im: 1 / Math.SQRT2 },
      };
    case 'H':
    default:
      return { Ex: { re: 1, im: 0 }, Ey: { re: 0, im: 0 } };
  }
}

function jonesIntensity(j: JonesVector): number {
  return (j.Ex.re ** 2 + j.Ex.im ** 2) + (j.Ey.re ** 2 + j.Ey.im ** 2);
}

/** Project a Jones vector onto a linear axis rotated by axisDeg from local X. */
function projectJones(j: JonesVector, axisDeg: number): JonesVector {
  const theta = (axisDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const projectionRe = j.Ex.re * cos + j.Ey.re * sin;
  const projectionIm = j.Ex.im * cos + j.Ey.im * sin;

  return {
    Ex: { re: projectionRe * cos, im: projectionIm * cos },
    Ey: { re: projectionRe * sin, im: projectionIm * sin },
  };
}

function identityAbcd(): ComplexABCD {
  return {
    A: { re: 1, im: 0 },
    B: { re: 0, im: 0 },
    C: { re: 0, im: 0 },
    D: { re: 1, im: 0 },
  };
}

// === Misc helpers ===

function numberOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function emptyTraceResult(revision: number): TraceResult {
  return {
    revision,
    engineCommit: ENGINE_COMMIT,
    segments: [],
    arrivals: [],
    losses: [],
    truncated: [],
    warnings: [],
    summary: {
      totalSegments: 0,
      totalArrivals: 0,
      totalPower: 0,
      energyConserved: true,
    },
  };
}
