/**
 * BB-05 Placement helpers
 *
 * Pure, DOM-free rules shared by the mouse interaction layer and tests:
 * - 25 mm optical-table hole snapping (coarse placement)
 * - table bounds clamping
 * - base collision detection
 * - mount DOF clamping
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface TableBounds {
  width: number;
  depth: number;
}

export interface DofLimits {
  min: number;
  max: number;
}

export interface MountAxes {
  tiltX: DofLimits;
  tiltY: DofLimits;
  rotationZ: DofLimits;
}

/** Standard optical breadboard hole pitch. */
export const HOLE_PITCH_M = 0.025;

/** Snap X/Z to the nearest hole position; Y is left untouched. */
export function snapToHoleGrid(
  position: Vec3Like,
  pitch: number = HOLE_PITCH_M
): Vec3Like {
  if (!(pitch > 0)) return { ...position };
  return {
    x: Math.round(position.x / pitch) * pitch,
    y: position.y,
    z: Math.round(position.z / pitch) * pitch,
  };
}

/** Keep a position inside the optical table and above its surface. */
export function clampToTable(
  position: Vec3Like,
  table: TableBounds
): Vec3Like {
  const halfWidth = table.width / 2;
  const halfDepth = table.depth / 2;
  return {
    x: Math.min(halfWidth, Math.max(-halfWidth, position.x)),
    y: Math.max(0, position.y),
    z: Math.min(halfDepth, Math.max(-halfDepth, position.z)),
  };
}

export type PlacementIssue = 'OUT_OF_BOUNDS' | 'OVERLAP';

export interface PlacedBase {
  position: Vec3Like;
  radius: number;
}

/**
 * Check whether a base can be placed.
 * @param position candidate centre (already snapped)
 * @param radius base footprint radius
 * @param table table bounds
 * @param existing already placed bases
 * @param clearance extra gap required between bases
 */
export function placementIssue(
  position: Vec3Like,
  radius: number,
  table: TableBounds,
  existing: readonly PlacedBase[],
  clearance: number = 0
): PlacementIssue | null {
  if (
    Math.abs(position.x) + radius > table.width / 2 + 1e-9 ||
    Math.abs(position.z) + radius > table.depth / 2 + 1e-9 ||
    position.y < 0
  ) {
    return 'OUT_OF_BOUNDS';
  }

  for (const base of existing) {
    const dx = position.x - base.position.x;
    const dz = position.z - base.position.z;
    const minDistance = radius + base.radius + clearance;
    if (dx * dx + dz * dz < minDistance * minDistance - 1e-12) {
      return 'OVERLAP';
    }
  }

  return null;
}

/** Clamp one axis value to its mechanical limits. */
export function clampDof(value: number, limits: DofLimits): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(limits.max, Math.max(limits.min, value));
}

export interface DofValues {
  tiltX: number;
  tiltY: number;
  rotationZ: number;
}

/** Clamp requested tilt/rotation adjustments to the mount limits. */
export function clampToMount(
  requested: Partial<DofValues>,
  axes: MountAxes
): Partial<DofValues> {
  const result: Partial<DofValues> = {};
  if (requested.tiltX !== undefined) result.tiltX = clampDof(requested.tiltX, axes.tiltX);
  if (requested.tiltY !== undefined) result.tiltY = clampDof(requested.tiltY, axes.tiltY);
  if (requested.rotationZ !== undefined) {
    result.rotationZ = clampDof(requested.rotationZ, axes.rotationZ);
  }
  return result;
}
