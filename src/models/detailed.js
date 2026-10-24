// Procedural teaching models. Coordinates follow the original optical heads.
// No geometry from this module participates in optical propagation.
/* global document */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const metal = (color, roughness = .4) => new THREE.MeshStandardMaterial({ color, metalness: .6, roughness });
const black = metal(0x1b1e23), steel = metal(0xb9c0c8, .28), brass = metal(0xb08d57);
const dark = new THREE.MeshStandardMaterial({ color: 0x131923, roughness: .65 });
const mirror = metal(0xcbd6df, .12);
mirror.side = THREE.DoubleSide;
const colors = { lens: 0x4aa3ff, thickLens: 0x4aa3ff, mirror: 0xc7d0da, polarizer: 0x37d67a,
  waveplate: 0xffa940, faraday: 0xb07cff, beamSplitter: 0x54d6ff, grating: 0xdca8ff,
  multimeter: 0xffd84a, source: 0xff5a5a, beamBlock: 0x6b7280 };
const accents = new Map(), glasses = new Map();
function accent(kind) {
  if (!accents.has(kind)) accents.set(kind, metal(colors[kind] ?? 0x9aa4b0));
  return accents.get(kind);
}
function glass(kind) {
  if (!glasses.has(kind)) glasses.set(kind, new THREE.MeshPhysicalMaterial({
    color: ({ lens: 0xd7f1ff, thickLens: 0xd7f1ff, polarizer: 0xd5ffe9, waveplate: 0xffe7c4,
      faraday: 0xefdcff, beamSplitter: 0xd4e4ff, grating: 0xe8d6ff })[kind] ?? 0xd7f1ff,
    metalness: 0, roughness: .04, transmission: .9, thickness: .0015, ior: 1.5,
    transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false,
  }));
  return glasses.get(kind);
}
function mesh(group, geometry, material, x = 0, y = 0, z = 0) {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  part.userData.isVisualOnly = true;
  part.userData.isDetailedModel = true;
  part.userData.bbOwnedGeometry = true;
  group.add(part);
  return part;
}
function box(g, w, h, d, mat, x = 0, y = 0, z = 0) {
  return mesh(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
}
function disc(g, r, depth, mat, z = 0, x = 0, y = 0) {
  const geometry = new THREE.CylinderGeometry(r, r, depth, 48);
  geometry.rotateX(Math.PI / 2);
  return mesh(g, geometry, mat, x, y, z);
}
function ring(g, inner, outer, depth, mat, z = 0) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 32, steps: 1 });
  geo.translate(0, 0, -depth / 2);
  return mesh(g, geo, mat, 0, 0, z);
}
function ticks(g, r, count, z, mat = steel) {
  for (let i = 0; i < count; i++) {
    const a = i * 2 * Math.PI / count;
    const tick = box(g, i % 3 === 0 ? .00010 : .00006, i % 3 === 0 ? .00030 : .00017, .000025,
      mat, Math.sin(a) * r, Math.cos(a) * r, z);
    tick.rotation.z = -a;
  }
}
function finish(g, target, hardware = false) {
  // Batch static decorations per material; axis markers stay in their own group.
  const batches = new Map();
  for (const part of [...g.children]) {
    if (!part.isMesh) continue;
    part.updateMatrix();
    const geo = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    geo.applyMatrix4(part.matrix);
    if (!batches.has(part.material)) batches.set(part.material, []);
    batches.get(part.material).push(geo);
    part.geometry.dispose(); g.remove(part);
  }
  for (const [material, geometries] of batches) {
    const combined = mergeGeometries(geometries, false);
    geometries.forEach(geo => geo.dispose());
    if (!combined) throw new Error('Detailed model: incompatible primitive attributes');
    const part = mesh(g, combined, material);
    part.userData.attachTarget = target;
    if (hardware) {
      part.userData.isHardwareMesh = true;
      part.userData.hardwareRole = 'head';
    }
  }
  return g;
}

function dialNumbers(g, radius, z) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c4cbd4'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let angle = 0; angle < 360; angle += 30) {
    const a = angle * Math.PI / 180;
    ctx.fillText(String(angle), 128 - Math.cos(a) * 108, 128 - Math.sin(a) * 108);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const part = mesh(g, new THREE.PlaneGeometry(radius * 2, radius * 2), mat, 0, 0, z);
  part.rotation.y = Math.PI;
  part.userData.bbOwnedMaterial = true;
  return part;
}

export function disposeDetailed(root) {
  if (!root) return;
  root.traverse(part => {
    if (part.userData?.bbOwnedGeometry) part.geometry?.dispose();
    if (part.userData?.bbOwnedMaterial) { part.material?.map?.dispose(); part.material?.dispose(); }
    if (part.userData?.isContour || part.parent?.name === 'UGI') {
      part.geometry?.dispose(); part.material?.dispose();
    }
    if (part.isSprite) { part.material?.map?.dispose(); part.material?.dispose(); }
  });
}

function releaseOnRemoval(root) {
  if (root.userData.bbDetailedRemovalBound) return;
  root.userData.bbDetailedRemovalBound = true;
  root.addEventListener('removed', () => {
    disposeDetailed(root);
    // Three.js uploads the invisible picking mesh too; it is per-element, not shared.
    root.geometry?.dispose();
  });
}

export function createDetailedHardware(target, { kind, width = .0036, height = .0036, attachTarget } = {}) {
  const aliases = { bs: 'beamSplitter', pbs: 'beamSplitter', detector: 'multimeter', beamDump: 'beamBlock' };
  kind = aliases[kind] ?? kind;
  const g = new THREE.Group(); g.name = `bb-detailed-hardware-${kind}`;
  const r = Math.min(width, height) * .46;
  const round = !['source', 'multimeter', 'beamBlock', 'grating'].includes(kind);
  Object.assign(g.userData, { isHardware: true, isDetailedModel: true, hardwareKind: kind,
    hasThroughAperture: round, headBottomLocal: -(height / 2 + .0011) });
  if (round) {
    const thick = kind === 'thickLens' ? (target.userData.element?.props.thickness ?? .004) / Math.max(1e-9, Math.abs(target.scale.z)) : null;
    const depth = thick === null ? .0010 : thick + .0006;
    const center = thick === null ? -.00015 : thick / 2;
    ring(g, r + .000015, r + .00065, depth, black, center);
    for (const z of [center - depth / 2 - .00002, center + depth / 2 + .00002]) ring(g, r + .00002, r + .00022, .00012, steel, z);
    ring(g, r + .00030, r + .00040, .000045, accent(kind), center - depth / 2 - .00006);
    box(g, .0012, .00065, .0010, black, 0, -(r + .00065), center);
    if (['polarizer', 'waveplate'].includes(kind)) {
      ticks(g, r + .00041, 72, -.00071);
      disc(g, .00026, .00045, brass, -.00015, r + .00061, 0);
      const marker = new THREE.Group(); marker.name = 'bb-axis-marker';
      box(marker, .00035, .00013, .00007, accent(kind), r + .00018, 0, -.00079);
      finish(marker, attachTarget ?? target, true); g.add(marker);
      const sync = () => { marker.rotation.z = THREE.MathUtils.degToRad(target.userData.element?.props.axisDeg ?? 0); };
      marker.children.forEach(p => { p.onBeforeRender = sync; }); sync();
      // Fixed zero mark and moving axis pointer occupy different radial tracks.
      box(g, .00025, .00013, .00005, brass, r + .00062, 0, -.00079);
    }
    if (kind === 'mirror') {
      ring(g, r * .68, r + .00025, .0003, black, .00092);
      for (const x of [-r * .8, r * .8]) {
        disc(g, .00019, .0006, steel, .00125, x, r * .65);
        disc(g, .00037, .0002, brass, .0016, x, r * .65);
      }
    }
  } else if (kind === 'grating') {
    const rail = .00045;
    for (const sign of [-1, 1]) {
      box(g, width + rail * 2, rail, .0008, black, 0, sign * (height / 2 + rail / 2));
      box(g, rail, height, .0008, black, sign * (width / 2 + rail / 2));
    }
    box(g, .0012, .00065, .001, black, 0, -(height / 2 + .0007));
  } else if (kind === 'source') {
    box(g, width * 1.7, height * 1.25, .006, black, 0, 0, -.0034);
    ring(g, .00075, .00125, .0011, steel, -.00030);
    ring(g, .00075, .0010, .00012, accent(kind), .00028);
    disc(g, .00045, .0006, brass, -.0066, width * .45, -height * .30);
    for (const sign of [-1, 1]) for (let i = 0; i < 4; i++) {
      box(g, .000025, .0015, .00016, steel, sign * width * .855, 0, -.002 - i * .00065);
    }
    g.userData.headBottomLocal = -height * .625;
  } else if (kind === 'multimeter') {
    // Opaque back is on +Z. The receiving window is on -Z.
    box(g, width + .0012, height + .0012, .0016, black, 0, 0, .00105);
    ring(g, r + .00001, r + .00043, .00035, black, -.00005);
    ring(g, r + .00002, r + .00014, .00006, accent(kind), -.00025);
    const connector = disc(g, .00032, .0009, steel, .0011, width / 2 + .00065, 0);
    connector.rotation.y = Math.PI / 2;
    box(g, .0011, .0005, .00006, steel, 0, -height * .3, .00188);
    box(g, .0012, .0006, .0010, black, 0, -(height / 2 + .00075), .0006);
  } else {
    disc(g, r + .0003, .0013, black, .0007);
    ring(g, r, r + .00030, .00016, accent(kind), -.00002);
    box(g, .0011, .00065, .001, black, 0, -(height / 2 + .0007), .0007);
  }
  finish(g, attachTarget ?? target, true);
  if (['polarizer', 'waveplate'].includes(kind)) {
    const dial = dialNumbers(g, r + .00065, -.00081);
    Object.assign(dial.userData, { attachTarget: attachTarget ?? target, isHardwareMesh: true, hardwareRole: 'head' });
  }
  target.add(g); releaseOnRemoval(target);
  return g;
}

function curvedDisc(g, r, curvature, z, scale, mat) {
  const positions = [], indices = [];
  const segs = 64, rings = 12;
  for (let j = 0; j <= rings; j++) for (let i = 0; i <= segs; i++) {
    const a = i * 2 * Math.PI / segs, rr = r * j / rings;
    const x = rr * Math.cos(a), y = rr * Math.sin(a);
    const rho2 = (x * scale.x) ** 2 + (y * scale.y) ** 2;
    const R = Math.abs(curvature);
    const sag = Number.isFinite(R) && R > 1e-9 ? Math.sign(curvature) * (R - Math.sqrt(Math.max(0, R * R - rho2))) : 0;
    positions.push(x, y, z + sag / scale.z);
    if (j < rings && i < segs) {
      const k = j * (segs + 1) + i;
      indices.push(k, k + segs + 1, k + 1, k + 1, k + segs + 1, k + segs + 2);
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(positions.flatMap((_, i) => i % 3 === 0 ? [positions[i] / (2 * r) + .5, positions[i + 1] / (2 * r) + .5] : []), 2));
  geo.setIndex(indices); geo.computeVertexNormals();
  return mesh(g, geo, mat);
}

function joinRims(g, frontGeometry, backGeometry, material) {
  const geometry = new THREE.BufferGeometry(), positions = [], indices = [];
  const front = frontGeometry.getAttribute('position'), back = backGeometry.getAttribute('position');
  for (let i = 0; i <= 64; i++) {
    for (const attr of [front, back]) { const k = 12 * 65 + i; positions.push(attr.getX(k), attr.getY(k), attr.getZ(k)); }
    if (i < 64) { const k = i * 2; indices.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(positions.length / 3 * 2).fill(0), 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return mesh(g, geometry, material);
}

export function applyDetailedElement(el) {
  if (!el?.mesh) return el;
  const root = el.mesh;
  const signature = JSON.stringify([el.type, el.props.f, el.props.R, el.props.R1, el.props.R2,
    el.props.flat, el.props.thickness, el.props.type, el.props.mode, el.props.polarizing, el.props.polTransmit, root.scale.toArray()]);
  if (root.userData.bbDetailedSignature === signature) return el;
  root.userData.bbDetailedSignature = signature;
  root.userData.bbDetailedReady = true;
  releaseOnRemoval(root);
  const legacy = root.children.find(c => c.isGroup && !c.userData.isHardware && !c.userData.isDetailedModel && c.name !== 'UGI');
  const mirrorSurface = legacy?.children.find(c => c.material?.map)?.material ?? mirror;
  if (legacy) legacy.visible = false; // Keep native physical surfaces attached and unchanged.
  const previous = root.children.find(c => c.name === 'bb-detailed-optic');
  if (previous) { disposeDetailed(previous); root.remove(previous); }
  const g = new THREE.Group(); g.name = 'bb-detailed-optic'; g.userData.isDetailedModel = true;
  const w = root.geometry.parameters.width, h = root.geometry.parameters.height;
  const r = Math.min(w, h) * .46, p = el.props, kind = el.type;
  const scale = new THREE.Vector3(Math.max(1e-9, Math.abs(root.scale.x)), Math.max(1e-9, Math.abs(root.scale.y)), Math.max(1e-9, Math.abs(root.scale.z)));
  if (kind === 'lens') {
    // Display shape only: f alone does not determine a manufactured lens profile.
    const R = Math.sign(p.f || 1) * r * 12 * scale.x;
    const edgeSag = (Math.abs(R) - Math.sqrt(R * R - (r * scale.x) ** 2)) / scale.z;
    const half = Math.abs(edgeSag) + .00013;
    curvedDisc(g, r, R, -half, scale, glass(kind));
    curvedDisc(g, r, -R, half, scale, glass(kind));
    joinRims(g, g.children[0].geometry, g.children[1].geometry, glass(kind));
  } else if (kind === 'thickLens' || kind === 'mirror') {
    const thick = (kind === 'thickLens' ? p.thickness : Math.max(.00018, p.thickness ?? .00018)) / scale.z;
    curvedDisc(g, r, kind === 'thickLens' ? p.R1 : p.flat ? Infinity : -p.R, 0, scale, kind === 'mirror' ? mirrorSurface : glass(kind));
    curvedDisc(g, r, kind === 'thickLens' ? p.R2 : Infinity, thick, scale, kind === 'mirror' ? black : glass(kind));
    // Side wall follows the same two spherical rims, rather than a flat cylinder.
    joinRims(g, g.children[0].geometry, g.children[1].geometry, kind === 'mirror' ? black : glass(kind));
  } else if (kind === 'multimeter') {
    disc(g, r, .00007, metalSensor(), -.00018);
    ring(g, r - .00008, r, .00004, steel, -.00023);
    el.props.detectorMode = 'front-absorbing';
    el.props.apertureRadius_m = r * Math.min(scale.x, scale.y);
  } else if (kind === 'beamBlock') {
    disc(g, r, .00012, dark, -.00008);
    ring(g, r * .45, r * .50, .00002, black, -.00015);
  } else if (kind === 'grating') {
    box(g, w, h, .0002, p.mode === 'reflective' ? mirror : glass(kind));
    // Readable groove-direction cue, not a literal micrometre-scale groove model.
    for (let i = -6; i <= 6; i++) box(g, .000015, h * .86, .000015, accent(kind), i * w / 16, 0, -.00012);
    box(g, w * .3, .00008, .00003, steel, 0, -h * .43, -.00014);
  } else if (kind === 'faraday') {
    ring(g, r * .72, r, .0016, black, -.00015);
    for (const z of [-.0010, .0007]) disc(g, r * .71, .00008, glass(kind), z);
    box(g, .00045, .00009, .00004, accent(kind), 0, -r * .8, -.00103);
  } else {
    disc(g, r, .00022, glass(kind));
    if (kind === 'beamSplitter') {
      ring(g, r * .92, r, .000025, accent(kind), -.00013);
      // Polarization reference on the rim, not an extra optical surface.
      if (p.polarizing) {
        const marker = box(g, .00008, r * .25, .000025, steel, 0, r * .80, -.00015);
        if (p.polTransmit === 'Horizontal') marker.rotation.z = Math.PI / 2;
      }
    }
  }
  finish(g, root);
  g.traverse(part => { if (part.isMesh) part.userData.element = el; });
  root.add(g);
  // Adapt the holder depth to the actual solid, without changing optical scale.
  const holder = root.children.find(c => c.userData.isHardware && c.userData.isDetailedModel);
  if (holder && kind === 'thickLens') {
    disposeDetailed(holder); root.remove(holder);
    createDetailedHardware(root, { kind, width: w, height: h });
  }
  return el;
}
let sensor;
function metalSensor() { return sensor ??= new THREE.MeshStandardMaterial({ color: 0x354968, metalness: .25, roughness: .25 }); }

export function decorateDetailedStand(stand) {
  const g = new THREE.Group(); g.name = 'bb-detailed-stand'; g.userData.isDetailedModel = true;
  // Base bolt sockets and collar locking knob, keeping original stand dimensions.
  for (const x of [-.0087, .0087]) {
    const socket = disc(g, .00045, .0001, dark, 0, x, .00272); socket.rotation.x = Math.PI / 2;
  }
  const legacyKnob = stand.children.find(part => part.userData.hardwareRole === 'post' &&
    part.position.x > .005 && part.geometry?.parameters?.height === .0010);
  if (legacyKnob) legacyKnob.visible = false;
  // The screw shaft enters the collar radially; the cap must not float beside it.
  const screw = disc(g, .0004, .0015, steel, 0, .00555, .00365); screw.rotation.y = Math.PI / 2;
  const knob = disc(g, .0009, .0006, brass, 0, .00625, .00365); knob.rotation.y = Math.PI / 2;
  finish(g, stand, true); stand.add(g); releaseOnRemoval(stand); return stand;
}

export function prepareDetailedPropagation(elements) {
  for (const el of elements) {
    applyDetailedElement(el);
    if (el.type === 'multimeter') {
      const size = el.mesh.geometry.parameters;
      el.props.detectorMode = 'front-absorbing';
      el.props.apertureRadius_m = Math.min(size.width * Math.abs(el.mesh.scale.x), size.height * Math.abs(el.mesh.scale.y)) * .46;
    }
  }
}

export function detectorFrontAccepts(direction, quaternion) {
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  return direction.dot(axis) > 1e-8;
}

export function detailedDetectorHit(el, path, metrics, readout, readings, options) {
  const facing = detectorFrontAccepts(path.dir, el.mesh.getWorldQuaternion(new THREE.Quaternion()));
  const local = el.mesh.worldToLocal(path.pos.clone());
  const r = Math.min(el.mesh.geometry.parameters.width, el.mesh.geometry.parameters.height) * .46;
  if (facing && Math.hypot(local.x, local.y) <= r) {
    readings.set(el.id, readout(path, metrics, options)); return true;
  }
  return false;
}
