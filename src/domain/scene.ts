/**
 * Simplified SceneV1 Schema - No THREE.js dependency for serialization
 */

export type PositionTuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];

export interface TableSpec {
  width: number;
  depth: number;
  cellSize: number;
}

export interface ViewParams {
  position: PositionTuple;
  target: PositionTuple;
  fov: number;
}

export type ElementKind = 
  | 'source' | 'raysSource' | 'lens' | 'thickLens'
  | 'mirror' | 'polarizer' | 'waveplate' | 'faraday'
  | 'pbs' | 'bs' | 'iris' | 'detector' | 'beamDump' | 'grating';

export type SourceProps = Record<string, unknown>;
export type OpticalProps = Record<string, unknown>;

export interface BaseElement {
  uuid: string;
  kind: ElementKind;
  name?: string;
  pose: {
    position: PositionTuple;
    orientation: QuaternionTuple;
  };
  mount: {
    pivotPoint: PositionTuple;
    axes: {
      tiltX: { min: number; max: number };
      tiltY: { min: number; max: number };
      rotationZ: { min: number; max: number };
    };
  };
  active: boolean;
  props: OpticalProps | SourceProps;
}

export interface SceneV1 {
  schemaVersion: 1;
  sceneId: string;
  revision: number;
  seed: number;
  table: TableSpec;
  elements: BaseElement[];
  camera: ViewParams;
  meta?: { title?: string; scenarioType?: string };
}
