/**
 * Upstream → SceneV1 snapshot mapping.
 *
 * The interactive Three.js app keeps its own objects; this module produces a
 * validated, serializable snapshot so the domain layer can answer get_state /
 * observe / capture for the same visual state. It never mutates upstream data.
 */

import {
  BaseElement,
  ElementKind,
  PositionTuple,
  QuaternionTuple,
  SceneV1,
} from '../domain/scene';

export interface PoseLike {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}

export interface UpstreamElementLike {
  uuid: string;
  type: string;
  mesh: PoseLike;
  props?: Record<string, unknown>;
}

export interface UpstreamSourceLike {
  uuid: string;
  group: PoseLike;
  props?: Record<string, unknown>;
}

export interface UpstreamSceneInput {
  sceneId: string;
  seed?: number;
  elements: readonly UpstreamElementLike[];
  sources: readonly UpstreamSourceLike[];
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    fov: number;
  };
  table?: { width: number; depth: number; cellSize: number };
}

const DEFAULT_MOUNT = {
  pivotPoint: [0, 0, 0] as PositionTuple,
  axes: {
    tiltX: { min: -0.1, max: 0.1 },
    tiltY: { min: -0.1, max: 0.1 },
    rotationZ: { min: 0, max: Math.PI },
  },
};

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positionTuple(pose: PoseLike): PositionTuple {
  return [
    finite(pose?.position?.x, 0),
    finite(pose?.position?.y, 0),
    finite(pose?.position?.z, 0),
  ];
}

function quaternionTuple(pose: PoseLike): QuaternionTuple {
  const x = finite(pose?.quaternion?.x, 0);
  const y = finite(pose?.quaternion?.y, 0);
  const z = finite(pose?.quaternion?.z, 0);
  const w = finite(pose?.quaternion?.w, 1);
  const length = Math.hypot(x, y, z, w);
  if (length < 1e-12) return [0, 0, 0, 1];
  return [x / length, y / length, z / length, w / length];
}

/** Map an upstream element type to a SceneV1 kind. */
export function mapElementKind(type: string): ElementKind | null {
  switch (type) {
    case 'lens': return 'lens';
    case 'thickLens': return 'thickLens';
    case 'mirror': return 'mirror';
    case 'polarizer': return 'polarizer';
    case 'waveplate': return 'waveplate';
    case 'faraday': return 'faraday';
    case 'beamSplitter': return 'bs';
    case 'beamBlock': return 'beamDump';
    case 'grating': return 'grating';
    case 'iris': return 'iris';
    case 'multimeter': return 'detector';
    case 'pbs': return 'pbs';
    case 'detector': return 'detector';
    default: return null;
  }
}

function mapPolarizationPreset(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  switch (text) {
    case 'Linear X': return 'H';
    case 'Linear Y': return 'V';
    case 'Diagonal': return 'D';
    case 'Anti-diagonal': return 'A';
    case 'Circular L': return 'RL';
    case 'Circular R': return 'R';
    default: return text || 'H';
  }
}

/** Build props that satisfy the domain validator for the mapped kind. */
export function mapElementProps(
  kind: ElementKind,
  raw: Record<string, unknown> | undefined
): Record<string, unknown> {
  const props = { ...(raw ?? {}) };
  // Internal identity metadata must not leak into the domain scene.
  delete props.__bbUuid;
  switch (kind) {
    case 'source':
    case 'raysSource': {
      const wavelength = finite(props.wavelength_nm, 632.8);
      return {
        ...props,
        wavelength_nm: wavelength > 0 ? wavelength : 632.8,
        forward_cm: Math.max(0, finite(props.forward_cm, 100)),
        backward_cm: Math.max(0, finite(props.backward_cm, 0)),
        polPreset: mapPolarizationPreset(props.polPreset),
        intensity_rel: Math.max(0, finite(props.intensity_rel, 1)),
        waist_um: Math.max(1, finite(props.waist_w0_um, 200)),
      };
    }
    case 'lens':
    case 'thickLens': {
      const focal = finite(props.focalLength_m ?? props.f, 0.1);
      return { ...props, focalLength_m: focal !== 0 ? focal : 0.1 };
    }
    case 'mirror':
    case 'bs':
    case 'pbs': {
      const reflectivity = Math.min(1, Math.max(0,
        finite(props.reflectivity ?? props.refl ?? props.R, kind === 'mirror' ? 1 : 0.5)));
      return { ...props, reflectivity };
    }
    case 'polarizer':
      return { ...props, axisAngleDeg: finite(props.axisAngleDeg ?? props.axisDeg, 0) };
    case 'waveplate':
      return { ...props, fastAxisAngleDeg: finite(props.fastAxisAngleDeg ?? props.axisDeg, 0) };
    case 'detector':
      return {
        ...props,
        apertureRadius_m: Math.max(1e-6,
          finite(props.apertureRadius_m ?? props.radius_m, 0.01)),
        efficiency: Math.min(1, Math.max(0, finite(props.efficiency, 1))),
      };
    case 'iris':
      return { ...props, radius_m: Math.max(0, finite(props.radius_m, 0.01)) };
    default:
      return props;
  }
}

function mountFromProps(raw: Record<string, unknown> | undefined): BaseElement['mount'] {
  const candidate = raw?.__bbMount as Partial<BaseElement['mount']> | undefined;
  if (!candidate || !candidate.axes || !Array.isArray(candidate.pivotPoint)) {
    return structuredClone(DEFAULT_MOUNT);
  }
  const axes = candidate.axes;
  const valid = ['tiltX', 'tiltY', 'rotationZ'].every((key) => {
    const limits = (axes as Record<string, { min?: unknown; max?: unknown }>)[key];
    return !!limits && Number.isFinite(limits.min) && Number.isFinite(limits.max);
  });
  if (!valid || candidate.pivotPoint.length !== 3 ||
      !candidate.pivotPoint.every((value) => Number.isFinite(value))) {
    return structuredClone(DEFAULT_MOUNT);
  }
  return {
    pivotPoint: [...candidate.pivotPoint] as PositionTuple,
    axes: {
      tiltX: { ...(axes.tiltX as { min: number; max: number }) },
      tiltY: { ...(axes.tiltY as { min: number; max: number }) },
      rotationZ: { ...(axes.rotationZ as { min: number; max: number }) },
    },
  };
}

function toElement(
  source: { uuid: string; type: string; mesh: PoseLike; props?: Record<string, unknown> },
  kind: ElementKind
): BaseElement {
  return {
    uuid: source.uuid,
    kind,
    name: typeof source.props?.label === 'string' ? source.props.label : undefined,
    active: true,
    pose: {
      position: positionTuple(source.mesh),
      orientation: quaternionTuple(source.mesh),
    },
    mount: mountFromProps(source.props),
    props: mapElementProps(kind, source.props),
  };
}

/** Convert the live upstream scene to a validated SceneV1 snapshot. */
export function sceneFromUpstream(input: UpstreamSceneInput): SceneV1 {
  const elements: BaseElement[] = [];

  for (const element of input.elements) {
    const kind = mapElementKind(element.type);
    if (!kind) continue;
    elements.push(toElement({
      uuid: element.uuid,
      type: element.type,
      mesh: element.mesh,
      props: element.props,
    }, kind));
  }

  for (const source of input.sources) {
    elements.push(toElement({
      uuid: source.uuid,
      type: 'source',
      mesh: source.group,
      props: source.props,
    }, 'source'));
  }

  return {
    schemaVersion: 1,
    sceneId: input.sceneId,
    revision: 0,
    seed: Number.isInteger(input.seed) ? (input.seed as number) : 42,
    table: input.table ?? { width: 1.2, depth: 0.9, cellSize: 0.025 },
    elements,
    camera: {
      position: [
        finite(input.camera.position.x, 0),
        finite(input.camera.position.y, 0.5),
        finite(input.camera.position.z, -1),
      ],
      target: [
        finite(input.camera.target.x, 0),
        finite(input.camera.target.y, 0.1),
        finite(input.camera.target.z, 0),
      ],
      fov: finite(input.camera.fov, Math.PI / 4),
    },
  };
}
