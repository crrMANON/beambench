/*!
 * BeamBench Copyright (C) 2025 VisuPhy
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// environment.js — optical table (Thorlabs-style breadboard), floor and legs.
//
// The environment is visual only: it is not selectable and never enters the
// optical element list or ray tracing. Hole geometry uses one InstancedMesh.
import * as THREE from 'three';

const TABLE_TOP_Y = -0.0152; // beam height ~15 mm above the breadboard
const HOLE_PITCH = 0.025;     // standard M6 breadboard pitch
const HOLE_RADIUS = 0.0031;

const MAT_TABLE = new THREE.MeshStandardMaterial({
  color: 0x9fa7b0, metalness: 0.86, roughness: 0.32,
});
const MAT_TABLE_EDGE = new THREE.MeshStandardMaterial({
  color: 0xc3c9d0, metalness: 0.88, roughness: 0.28,
});
const MAT_HOLE = new THREE.MeshStandardMaterial({
  color: 0x25292e, metalness: 0.35, roughness: 0.85,
});
const MAT_LEG = new THREE.MeshStandardMaterial({
  color: 0x5b626b, metalness: 0.85, roughness: 0.35,
});
const MAT_FLOOR = new THREE.MeshStandardMaterial({
  color: 0x353b43, metalness: 0.05, roughness: 0.95,
});

function addBox(group, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.userData.isEnvironment = true;
  group.add(mesh);
  return mesh;
}

/**
 * Build the lab environment group.
 * @returns {THREE.Group}
 */
export function createLabEnvironment({
  width = 1.4,
  depth = 1.0,
  topY = TABLE_TOP_Y,
  pitch = HOLE_PITCH,
  holeRadius = HOLE_RADIUS,
  floorY = -0.45,
} = {}) {
  const group = new THREE.Group();
  group.name = 'beambench-environment';
  group.userData.isEnvironment = true;

  // Breadboard slab.
  const thickness = 0.022;
  addBox(group, width, thickness, depth, MAT_TABLE, 0, topY - thickness / 2, 0);

  // Perimeter frame and corner blocks give a recognizable breadboard silhouette.
  const frame = 0.018;
  const frameH = 0.004;
  addBox(group, width, frameH, frame, MAT_TABLE_EDGE, 0, topY + frameH / 2 - 0.001, -depth / 2 + frame / 2);
  addBox(group, width, frameH, frame, MAT_TABLE_EDGE, 0, topY + frameH / 2 - 0.001, depth / 2 - frame / 2);
  addBox(group, frame, frameH, depth, MAT_TABLE_EDGE, -width / 2 + frame / 2, topY + frameH / 2 - 0.001, 0);
  addBox(group, frame, frameH, depth, MAT_TABLE_EDGE, width / 2 - frame / 2, topY + frameH / 2 - 0.001, 0);

  // Mounting-hole grid as a single instanced mesh.
  const margin = 0.035;
  const columns = Math.floor((width - 2 * margin) / pitch) + 1;
  const rows = Math.floor((depth - 2 * margin) / pitch) + 1;
  const holeGeometry = new THREE.CylinderGeometry(holeRadius, holeRadius, 0.0016, 8);
  const holes = new THREE.InstancedMesh(holeGeometry, MAT_HOLE, columns * rows);
  holes.userData.isEnvironment = true;
  holes.userData.isTableHoles = true;

  const matrix = new THREE.Matrix4();
  let index = 0;
  for (let row = 0; row < rows; row++) {
    const z = -depth / 2 + margin + row * pitch;
    for (let column = 0; column < columns; column++) {
      const x = -width / 2 + margin + column * pitch;
      matrix.makeTranslation(x, topY - 0.0003, z);
      holes.setMatrixAt(index++, matrix);
    }
  }
  holes.count = index;
  holes.instanceMatrix.needsUpdate = true;
  holes.computeBoundingSphere();
  group.add(holes);

  // Frame-mounted legs (visual grounding, outside the breadboard footprint).
  const legHeight = Math.max(0.1, topY - thickness - floorY);
  const legRadius = 0.016;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(legRadius, legRadius, legHeight, 16),
        MAT_LEG
      );
      leg.position.set(
        sx * (width / 2 - 0.09),
        topY - thickness - legHeight / 2,
        sz * (depth / 2 - 0.09)
      );
      leg.userData.isEnvironment = true;
      group.add(leg);

      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.034, 0.038, 0.012, 20),
        MAT_LEG
      );
      foot.position.set(leg.position.x, floorY + 0.006, leg.position.z);
      foot.userData.isEnvironment = true;
      group.add(foot);
    }
  }

  // Lab floor and a subtle 1 m reference grid.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), MAT_FLOOR);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.userData.isEnvironment = true;
  group.add(floor);

  const floorGrid = new THREE.GridHelper(10, 100, 0x343941, 0x272b31);
  floorGrid.position.y = floorY + 0.001;
  floorGrid.material.transparent = true;
  floorGrid.material.opacity = 0.5;
  floorGrid.userData.isEnvironment = true;
  group.add(floorGrid);

  group.userData.table = { width, depth, topY, pitch, columns, rows, holes: index };
  return group;
}

export const TABLE_METRICS = {
  TABLE_TOP_Y,
  HOLE_PITCH,
  HOLE_RADIUS,
};
