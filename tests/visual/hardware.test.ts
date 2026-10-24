/**
 * Procedural optomechanics tests (no renderer required).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - upstream module is plain JS
import { attachHardware, createStand, updateStand, STAND_METRICS } from '../../src/upstream/hardware.js';

function makeElementMesh(width = 0.0036, height = 0.0036) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, 1e-6));
}

function hardwareMeshes(group: THREE.Group) {
  const meshes: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object.userData?.isHardwareMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
}

describe('Thorlabs-inspired hardware', () => {
  it('attaches a visual-only mount group to an optical mesh', () => {
    const mesh = makeElementMesh();
    const group = attachHardware(mesh, { kind: 'mirror', width: 0.004, height: 0.004 });

    expect(group).toBeTruthy();
    expect(group!.userData.isHardware).toBe(true);
    expect(group!.userData.hardwareKind).toBe('mirror');
    expect(mesh.children).toContain(group);

    const meshes = hardwareMeshes(group!);
    expect(meshes.length).toBeGreaterThanOrEqual(4);
    for (const part of meshes) {
      expect(part.userData.isVisualOnly).toBe(true);
      expect(part.userData.isCollisionMesh).toBeUndefined();
    }
  });

  it('uses a rotation mount with graduations for polarizers and waveplates', () => {
    const polarizer = attachHardware(makeElementMesh(), { kind: 'polarizer' })!;
    const mirror = attachHardware(makeElementMesh(), { kind: 'mirror' })!;

    expect(hardwareMeshes(polarizer).length).toBeGreaterThan(hardwareMeshes(mirror).length);
  });

  it('builds source, beam-block and detector hardware variants', () => {
    for (const kind of ['source', 'beamDump', 'detector', 'grating', 'lens', 'bs']) {
      const group = attachHardware(makeElementMesh(), { kind })!;
      expect(group.userData.hardwareKind).toBe(kind);
      expect(hardwareMeshes(group).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('provides a separate stand with base, collar and an adjustable post', () => {
    const stand = createStand();
    expect(stand.userData.isStand).toBe(true);
    const roles = new Set<string>();
    let base = null;
    let post = null;
    stand.traverse((part) => {
      if (!part.userData?.isHardwareMesh) return;
      roles.add(part.userData.hardwareRole);
      if (part.userData.hardwareRole === 'base') base = part;
      if (part.userData.isPostShaft) post = part;
    });
    expect(roles).toEqual(new Set(['base', 'post']));
    expect(base).toBeTruthy();
    expect(post).toBeTruthy();

    updateStand(stand, {
      x: 0.1, z: -0.2, yaw: 0.3, headBottom: 0.02, tableTop: -0.0152,
    });
    expect(stand.position.toArray()).toEqual([0.1, -0.0152, -0.2]);
    expect(stand.userData.postHeight).toBeCloseTo(0.02 - (-0.0152 + STAND_METRICS.collarTop), 6);
    expect(post!.scale.y).toBeCloseTo(stand.userData.postHeight, 6);

    // A head pushed below the base must never let the post pierce it.
    updateStand(stand, {
      x: 0, z: 0, yaw: 0, headBottom: -0.02, tableTop: -0.0152,
    });
    expect(stand.userData.postHeight).toBeLessThanOrEqual(0.0003 + 1e-9);
  });

  it('uses open frames with two retaining rings for optics', () => {
    const optic = attachHardware(makeElementMesh(), { kind: 'mirror' })!;
    expect(optic.userData.hasThroughAperture).toBe(true);
    let rings = 0;
    optic.traverse((part) => {
      if ((part as THREE.Mesh).geometry?.type === 'TorusGeometry') rings++;
    });
    expect(rings).toBeGreaterThanOrEqual(2);

    const source = attachHardware(makeElementMesh(), { kind: 'source' })!;
    expect(source.userData.hasThroughAperture).toBe(false);
  });

  it('shares materials across mounts', () => {
    const first = attachHardware(makeElementMesh(), { kind: 'lens' })!;
    const second = attachHardware(makeElementMesh(), { kind: 'mirror' })!;
    const firstMaterials = new Set(hardwareMeshes(first).map((mesh) => mesh.material));
    const secondMaterials = new Set(hardwareMeshes(second).map((mesh) => mesh.material));
    const shared = [...firstMaterials].some((material) => secondMaterials.has(material));
    expect(shared).toBe(true);
  });
});
