/**
 * Lab environment tests (breadboard table, floor, legs) without a renderer.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
// @ts-ignore - upstream module is plain JS
import { createLabEnvironment, TABLE_METRICS } from '../../src/upstream/environment.js';

describe('Optical table environment', () => {
  it('builds a laboratory environment with an instanced breadboard hole grid', () => {
    const environment = createLabEnvironment();

    expect(environment.userData.isEnvironment).toBe(true);
    const table = environment.userData.table;
    expect(table.pitch).toBe(0.025);
    expect(table.holes).toBeGreaterThan(1000);

    let holes: THREE.InstancedMesh | null = null;
    let environmentMeshes = 0;
    environment.traverse((object) => {
      if (object.userData?.isTableHoles) holes = object as THREE.InstancedMesh;
      if (object.userData?.isEnvironment && (object as THREE.Mesh).isMesh) environmentMeshes++;
    });

    expect(holes).not.toBeNull();
    expect(holes!.count).toBe(table.holes);
    expect(holes!.isInstancedMesh).toBe(true);
    expect(environmentMeshes).toBeGreaterThan(10);
  });

  it('places the table below the optical axis and reports standard metrics', () => {
    const environment = createLabEnvironment();
    expect(environment.userData.table.topY).toBeLessThan(0);
    expect(TABLE_METRICS.HOLE_PITCH).toBe(0.025);
    expect(TABLE_METRICS.TABLE_TOP_Y).toBeCloseTo(-0.0152, 6);
  });

  it('includes a floor and four legs for scale context', () => {
    const environment = createLabEnvironment();
    const geometries = new Map<string, number>();
    environment.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const type = mesh.geometry.type;
      geometries.set(type, (geometries.get(type) ?? 0) + 1);
    });
    expect(geometries.get('CylinderGeometry')).toBeGreaterThanOrEqual(9);
    expect(geometries.get('PlaneGeometry')).toBeGreaterThanOrEqual(1);
    expect(geometries.get('BoxGeometry')).toBeGreaterThanOrEqual(5);
  });
});
