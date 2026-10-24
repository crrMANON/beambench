/*!
 * BeamBench Copyright (C) 2025 VisuPhy
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// hardware.js — procedural Thorlabs-inspired optomechanics.
//
// These meshes are visual only. They are attached as children of the optical
// collision mesh, so they follow placement/gizmo transforms, but they are not
// in `elements` or `selectable` and never take part in ray tracing.
import * as THREE from 'three';

export const MODEL_SCALE = 3; // optical head world scale (was 2 -> +50 %)
export const STAND_SCALE = 1.5;

const MAT_ANODIZED = new THREE.MeshStandardMaterial({
  color: 0x1b1e23, metalness: 0.55, roughness: 0.5,
});
const MAT_STEEL = new THREE.MeshStandardMaterial({
  color: 0xb9c0c8, metalness: 0.9, roughness: 0.28,
});
const MAT_BRASS = new THREE.MeshStandardMaterial({
  color: 0xb08d57, metalness: 0.75, roughness: 0.35,
});
const MAT_RING = new THREE.MeshStandardMaterial({
  color: 0x2a2e35, metalness: 0.45, roughness: 0.6,
});

const ACCENT_BY_KIND = {
  lens: 0x4aa3ff,
  thickLens: 0x4aa3ff,
  mirror: 0xc7d0da,
  polarizer: 0x37d67a,
  waveplate: 0xffa940,
  faraday: 0xb07cff,
  bs: 0x54d6ff,
  pbs: 0x54d6ff,
  grating: 0xdca8ff,
  beamDump: 0x6b7280,
  beamBlock: 0x6b7280,
  detector: 0xffd84a,
  multimeter: 0xffd84a,
  source: 0xff5a5a,
};

const accentMaterials = new Map();

function accentMaterial(kind) {
  const color = ACCENT_BY_KIND[kind] ?? 0x9aa4b0;
  if (!accentMaterials.has(color)) {
    accentMaterials.set(color, new THREE.MeshStandardMaterial({
      color, metalness: 0.45, roughness: 0.35,
      emissive: color, emissiveIntensity: 0.12,
    }));
  }
  return accentMaterials.get(color);
}

const geometryCache = new Map();

function boxGeo(w, h, d) {
  const key = `b:${w}:${h}:${d}`;
  if (!geometryCache.has(key)) {
    geometryCache.set(key, new THREE.BoxGeometry(w, h, d));
  }
  return geometryCache.get(key);
}

function cylGeo(rTop, rBottom, height, segments = 12) {
  const key = `c:${rTop}:${rBottom}:${height}:${segments}`;
  if (!geometryCache.has(key)) {
    geometryCache.set(key, new THREE.CylinderGeometry(rTop, rBottom, height, segments));
  }
  return geometryCache.get(key);
}

function torusGeo(radius, tube, radialSegments = 10, tubularSegments = 28) {
  const key = `t:${radius}:${tube}:${radialSegments}:${tubularSegments}`;
  if (!geometryCache.has(key)) {
    geometryCache.set(key, new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments));
  }
  return geometryCache.get(key);
}

function addMesh(group, geometry, material, position, rotation) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.isVisualOnly = true;
  mesh.userData.isHardwareMesh = true;
  group.add(mesh);
  return mesh;
}

function addSquareMount(group, { width, height, kind }) {
  // Open frame: four rails leave the optical aperture clear from both sides.
  const frameW = width + 0.0016;
  const frameH = height + 0.0016;
  const depth = 0.0013;
  const rail = 0.0007;

  addMesh(group, boxGeo(frameW, rail, depth), MAT_ANODIZED,
    [0, frameH / 2 - rail / 2, -0.00045]);
  addMesh(group, boxGeo(frameW, rail, depth), MAT_ANODIZED,
    [0, -frameH / 2 + rail / 2, -0.00045]);
  addMesh(group, boxGeo(rail, frameH, depth), MAT_ANODIZED,
    [frameW / 2 - rail / 2, 0, -0.00045]);
  addMesh(group, boxGeo(rail, frameH, depth), MAT_ANODIZED,
    [-frameW / 2 + rail / 2, 0, -0.00045]);

  // Front and rear retaining rings so the optic reads as mounted from both sides.
  const ringRadius = Math.min(width, height) * 0.46;
  for (const z of [0.00020, -0.00020]) {
    addMesh(group, torusGeo(ringRadius, 0.00020), accentMaterial(kind), [0, 0, z]);
  }

  // Small carrier bracket that joins the frame to the post.
  addMesh(group, boxGeo(width * 0.55, 0.0007, 0.0009), MAT_ANODIZED,
    [0, -(height / 2 + 0.00055), -0.0003]);

  // Two adjuster screws with knurled brass knobs (behind the frame).
  const screwY = height * 0.30;
  for (const dx of [-1, 1]) {
    const x = dx * (width / 2 + 0.00045);
    addMesh(group, cylGeo(0.00034, 0.00034, 0.0016, 10), MAT_STEEL,
      [x, screwY, -0.00115], [Math.PI / 2, 0, 0]);
    addMesh(group, cylGeo(0.00058, 0.00058, 0.00024, 12), MAT_BRASS,
      [x, screwY, -0.0020], [Math.PI / 2, 0, 0]);
  }
}

function addRotationMount(group, { width, height, kind }) {
  const frameW = width + 0.0020;
  const frameH = height + 0.0020;
  const depth = 0.0014;
  const rail = 0.0007;

  addMesh(group, boxGeo(frameW, rail, depth), MAT_ANODIZED,
    [0, frameH / 2 - rail / 2, -0.00045]);
  addMesh(group, boxGeo(frameW, rail, depth), MAT_ANODIZED,
    [0, -frameH / 2 + rail / 2, -0.00045]);
  addMesh(group, boxGeo(rail, frameH, depth), MAT_ANODIZED,
    [frameW / 2 - rail / 2, 0, -0.00045]);
  addMesh(group, boxGeo(rail, frameH, depth), MAT_ANODIZED,
    [-frameW / 2 + rail / 2, 0, -0.00045]);

  const radius = Math.min(width, height) * 0.52;
  for (const z of [0.00022, -0.00022]) {
    addMesh(group, torusGeo(radius, 0.00024, 10, 36), accentMaterial(kind), [0, 0, z]);
  }
  addMesh(group, boxGeo(0.00045, 0.00012, 0.0009), MAT_BRASS,
    [0, radius, 0.00022]);
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2;
    addMesh(group, boxGeo(0.00030, 0.00008, 0.00010), MAT_STEEL,
      [Math.sin(angle) * radius * 0.94, Math.cos(angle) * radius * 0.94, 0.00030],
      [0, 0, -angle]);
  }
  addMesh(group, boxGeo(width * 0.55, 0.0007, 0.0009), MAT_ANODIZED,
    [0, -(height / 2 + 0.00055), -0.0003]);
}

function addBeamBlockHardware(group, { width, height, kind }) {
  addMesh(group, cylGeo(width * 0.42, width * 0.34, 0.0042, 16), MAT_ANODIZED,
    [0, 0.0004, -0.0002], [Math.PI / 2, 0, 0]);
  addMesh(group, torusGeo(width * 0.30, 0.00020), accentMaterial(kind),
    [0, 0.0004, 0.0019]);
}

function addSourceHardware(group, { width, height, kind }) {
  // Laser head body with a small aperture and a rear connector.
  addMesh(group, boxGeo(width * 1.7, height * 1.25, 0.006), MAT_ANODIZED,
    [0, 0.0004, -0.0036]);
  addMesh(group, cylGeo(0.0011, 0.0011, 0.0010, 14), MAT_STEEL,
    [0, 0.0004, -0.0004], [Math.PI / 2, 0, 0]);
  addMesh(group, cylGeo(0.0007, 0.0007, 0.0008, 10), MAT_BRASS,
    [width * 0.45, -height * 0.32, -0.0058], [Math.PI / 2, 0, 0]);
  addMesh(group, torusGeo(0.0016, 0.00022), accentMaterial(kind),
    [0, 0.0004, -0.00005]);
}

function addDetectorHardware(group, { width, height, kind }) {
  addMesh(group, boxGeo(width + 0.0014, height + 0.0014, 0.0022), MAT_ANODIZED,
    [0, 0, -0.0012]);
  addMesh(group, cylGeo(0.0009, 0.0009, 0.0016, 12), MAT_STEEL,
    [width * 0.30, -height * 0.28, -0.0026], [Math.PI / 2, 0, 0]);
  addMesh(group, torusGeo(0.0015, 0.00020), accentMaterial(kind),
    [0, 0, 0.00010]);
}

const BUILDERS = {
  square: addSquareMount,
  rotation: addRotationMount,
  block: addBeamBlockHardware,
  detector: addDetectorHardware,
  source: addSourceHardware,
};

const KIND_STYLE = {
  lens: 'square',
  thickLens: 'square',
  mirror: 'square',
  polarizer: 'rotation',
  waveplate: 'rotation',
  faraday: 'rotation',
  bs: 'square',
  pbs: 'square',
  grating: 'square',
  beamDump: 'block',
  beamBlock: 'block',
  detector: 'detector',
  multimeter: 'detector',
  source: 'source',
};

/**
 * Attach procedural mount hardware to an optical element.
 * Geometry is expressed in the panel's pre-scale units, so it scales with the
 * optic just like the existing visual mesh.
 */
export function attachHardware(collisionMesh, {
  kind, width = 0.0036, height = 0.0036, attachTarget,
} = {}) {
  if (!collisionMesh) return null;
  const style = KIND_STYLE[kind] ?? 'square';
  const builder = BUILDERS[style] ?? addSquareMount;

  const hardware = new THREE.Group();
  hardware.name = `bb-hardware-${kind ?? 'optic'}`;
  hardware.userData.isHardware = true;
  hardware.userData.hardwareKind = kind ?? 'optic';
  hardware.userData.wasPickable = false;

  builder(hardware, { width, height, kind });
  // Mount hardware participates in picking but maps back to its optic/source.
  hardware.userData.hasThroughAperture = style === 'square' || style === 'rotation';
  hardware.userData.headBottomLocal =
    style === 'source' ? (0.0004 - height * 0.625) :
    style === 'rotation' ? -(height / 2 + 0.0011) :
    style === 'detector' ? -(height / 2 + 0.0007) :
    style === 'block' ? Math.min(-(height / 2 + 0.0008), 0.0004 - width * 0.42) :
    -(height / 2 + 0.0008);

  hardware.traverse((part) => {
    if (part.userData?.isHardwareMesh) {
      part.userData.attachTarget = attachTarget ?? collisionMesh;
      part.userData.hardwareRole = 'head';
    }
  });
  collisionMesh.add(hardware);
  return hardware;
}

/* ================= Stand: base + collar + height-adjustable post ========= */
export const STAND_METRICS = {
  // Horizontal footprint grows with the optics; the vertical column stays
  // compact so the enlarged head still clears the breadboard.
  baseWidth: 0.016 * STAND_SCALE,
  baseHeight: 0.0024,
  collarRadius: 0.0032 * STAND_SCALE,
  collarHeight: 0.0025,
  collarTop: 0.0049,
  postRadius: 0.0011 * STAND_SCALE,
  minPost: 0.001,
  maxPost: 0.06,
};

function addStandMesh(group, geometry, material, role, y) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, y, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.isVisualOnly = true;
  mesh.userData.isHardwareMesh = true;
  mesh.userData.isStandMesh = true;
  mesh.userData.hardwareRole = role;
  group.add(mesh);
  return mesh;
}

/** Create a base/post assembly. The group origin is the table surface. */
export function createStand() {
  const group = new THREE.Group();
  group.name = 'bb-stand';
  group.userData.isStand = true;
  group.userData.isHardware = true;

  const base = addStandMesh(
    group,
    boxGeo(STAND_METRICS.baseWidth, STAND_METRICS.baseHeight, STAND_METRICS.baseWidth),
    MAT_ANODIZED, 'base', STAND_METRICS.baseHeight / 2
  );
  base.name = 'bb-stand-base';

  // Two socket-head screws in the base plate.
  for (const dx of [-0.0058 * STAND_SCALE, 0.0058 * STAND_SCALE]) {
    addStandMesh(group, cylGeo(0.0006 * STAND_SCALE, 0.0006 * STAND_SCALE, 0.0003, 8), MAT_STEEL, 'base', 0.00255)
      .position.x = dx;
  }

  const collar = addStandMesh(
    group, cylGeo(STAND_METRICS.collarRadius, STAND_METRICS.collarRadius,
      STAND_METRICS.collarHeight, 14), MAT_ANODIZED, 'post',
    STAND_METRICS.baseHeight + STAND_METRICS.collarHeight / 2
  );
  collar.name = 'bb-stand-collar';

  addStandMesh(group, cylGeo(0.0005 * STAND_SCALE, 0.0005 * STAND_SCALE, 0.0010, 8), MAT_BRASS, 'post',
    STAND_METRICS.baseHeight + STAND_METRICS.collarHeight / 2)
    .position.x = STAND_METRICS.collarRadius + 0.0005 * STAND_SCALE;

  const post = addStandMesh(
    group, cylGeo(STAND_METRICS.postRadius, STAND_METRICS.postRadius, 1, 12),
    MAT_STEEL, 'post', STAND_METRICS.collarTop + 0.001
  );
  post.name = 'bb-stand-post';
  post.userData.isPostShaft = true;

  const clamp = addStandMesh(
    group, cylGeo(0.0019 * STAND_SCALE, 0.0019 * STAND_SCALE, 0.0012, 10), MAT_ANODIZED, 'post', 0
  );
  clamp.name = 'bb-stand-top-clamp';

  group.userData.base = base;
  group.userData.post = post;
  group.userData.topClamp = clamp;
  group.userData.postHeight = STAND_METRICS.minPost;
  return group;
}

/**
 * Place the stand under a head. `headBottom` is the world Y of the optic's
 * lower edge; the post is clamped so it never leaves the base or pierces it.
 */
export function updateStand(stand, {
  x, z, yaw, headBottom, tableTop,
}) {
  if (!stand) return STAND_METRICS.minPost;
  stand.position.set(x, tableTop, z);
  stand.rotation.y = yaw;

  const collarTopWorld = tableTop + STAND_METRICS.collarTop;
  // The post must never extend above the head; clamp to the available gap.
  const height = Math.max(
    0.0003,
    Math.min(STAND_METRICS.maxPost, headBottom - collarTopWorld)
  );

  const post = stand.userData.post;
  const clamp = stand.userData.topClamp;
  post.scale.y = height;
  post.position.y = STAND_METRICS.collarTop + height / 2;
  clamp.position.y = STAND_METRICS.collarTop + height;
  stand.userData.postHeight = height;
  return height;
}

export const HARDWARE_MATERIALS = {
  MAT_ANODIZED,
  MAT_STEEL,
  MAT_BRASS,
  MAT_RING,
};
