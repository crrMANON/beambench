/**
 * BB-05 placement rule tests (pure functions, no DOM).
 */
import { describe, it, expect } from 'vitest';
import {
  HOLE_PITCH_M,
  clampDof,
  clampToMount,
  clampToTable,
  placementIssue,
  snapToHoleGrid,
} from '../../src/interaction/placement';

describe('25 mm hole snapping', () => {
  it('snaps to the nearest hole', () => {
    expect(snapToHoleGrid({ x: 0.012, y: 0.1, z: 0.013 }))
      .toEqual({ x: 0, y: 0.1, z: 0.025 });
    expect(snapToHoleGrid({ x: 0.037, y: 0, z: -0.038 }))
      .toEqual({ x: 0.025, y: 0, z: -0.05 });
  });

  it('preserves already-snapped positions', () => {
    const snapped = snapToHoleGrid({ x: 0.125, y: 0.02, z: -0.075 });
    expect(snapped.x).toBeCloseTo(0.125, 12);
    expect(snapped.y).toBe(0.02);
    expect(snapped.z).toBeCloseTo(-0.075, 12);
  });

  it('uses the standard 25 mm pitch', () => {
    expect(HOLE_PITCH_M).toBe(0.025);
  });

  it('leaves positions untouched for an invalid pitch', () => {
    expect(snapToHoleGrid({ x: 0.0123, y: 0.1, z: 0.04 }, 0))
      .toEqual({ x: 0.0123, y: 0.1, z: 0.04 });
  });
});

describe('table bounds', () => {
  const table = { width: 1.2, depth: 0.9 };

  it('clamps X/Z to the table and Y to the surface', () => {
    expect(clampToTable({ x: 0.9, y: -0.2, z: -0.8 }, table))
      .toEqual({ x: 0.6, y: 0, z: -0.45 });
  });

  it('keeps in-bounds positions unchanged', () => {
    expect(clampToTable({ x: 0.2, y: 0.1, z: 0.3 }, table))
      .toEqual({ x: 0.2, y: 0.1, z: 0.3 });
  });
});

describe('placement collision', () => {
  const table = { width: 1.2, depth: 0.9 };

  it('rejects bases hanging over the table edge', () => {
    expect(placementIssue({ x: 0.6, y: 0, z: 0 }, 0.03, table, [])).toBe('OUT_OF_BOUNDS');
  });

  it('rejects overlapping bases', () => {
    const existing = [{ position: { x: 0.1, y: 0, z: 0.1 }, radius: 0.03 }];
    expect(placementIssue({ x: 0.11, y: 0, z: 0.1 }, 0.03, table, existing)).toBe('OVERLAP');
  });

  it('accepts bases with enough clearance', () => {
    const existing = [{ position: { x: 0.1, y: 0, z: 0.1 }, radius: 0.03 }];
    expect(placementIssue({ x: 0.2, y: 0, z: 0.1 }, 0.03, table, existing)).toBeNull();
  });

  it('respects extra clearance', () => {
    const existing = [{ position: { x: 0.1, y: 0, z: 0.1 }, radius: 0.03 }];
    expect(placementIssue({ x: 0.17, y: 0, z: 0.1 }, 0.03, table, existing, 0.02))
      .toBe('OVERLAP');
  });
});

describe('mount DOF limits', () => {
  const axes = {
    tiltX: { min: -0.1, max: 0.1 },
    tiltY: { min: -0.05, max: 0.05 },
    rotationZ: { min: 0, max: Math.PI },
  };

  it('clamps values into range', () => {
    expect(clampDof(0.2, axes.tiltX)).toBe(0.1);
    expect(clampDof(-0.2, axes.tiltX)).toBe(-0.1);
    expect(clampDof(0.01, axes.tiltX)).toBe(0.01);
  });

  it('falls back to zero for non-finite input', () => {
    expect(clampDof(NaN, axes.tiltX)).toBe(0);
    expect(clampDof(Infinity, axes.tiltY)).toBe(0);
  });

  it('clamps only requested axes', () => {
    expect(clampToMount({ tiltX: 0.5 }, axes)).toEqual({ tiltX: 0.1 });
    expect(clampToMount({ tiltY: -0.2, rotationZ: 5 }, axes))
      .toEqual({ tiltY: -0.05, rotationZ: Math.PI });
  });
});
