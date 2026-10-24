import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { transformDetailedSource, detailedModelsPlugin } from '../../tools/detailed-models.mjs';
import { applyDetailedElement, createDetailedHardware, decorateDetailedStand, prepareDetailedPropagation,
  detectorFrontAccepts, disposeDetailed } from '../../src/models/detailed.js';
import { createStand } from '../../src/upstream/hardware.js';

const typeNames = { lens: 'makeLens', thickLens: 'makeThickLens', mirror: 'makeMirror', polarizer: 'makePolarizer',
  waveplate: 'makeWaveplate', faraday: 'makeFaraday', beamSplitter: 'makeBeamSplitter', beamBlock: 'makeBeamBlock',
  grating: 'makeGrating', multimeter: 'makeMultimeter' };
let native: any, detailed: any, propagation: any, detailedTrace: any;
const ctx = new Proxy({ measureText: () => ({ width: 100 }), createLinearGradient: () => ({ addColorStop() {} }) },
  { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });

beforeAll(async () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
  native = await import('../../src/upstream/elements.js');
  const loadAdapted = async (file: string) => {
    const path = resolve(file), out = resolve('artifacts/detailed-models-20261024/test-runtime', file.replaceAll('/', '-'));
    mkdirSync(dirname(out), { recursive: true });
    const code = transformDetailedSource(readFileSync(path, 'utf8'), path)
      .replace(/from ['"](\.\/[^'"]+)['"]/g, (_: string, relative: string) => `from '${resolve(dirname(path), relative)}'`)
      .replaceAll("'/src/models/detailed.js'", `'${resolve('src/models/detailed.js')}'`);
    writeFileSync(out, code);
    return import(out);
  };
  detailed = await loadAdapted('src/upstream/elements.js');
  propagation = await loadAdapted('src/upstream/propagation.js');
  detailedTrace = await loadAdapted('src/physics/trace.ts');
});
afterAll(() => vi.unstubAllGlobals());

describe('Separate detailed model adapters', () => {
  it('leaves original builds and unrelated files untouched, and rejects stale anchors', () => {
    const code = readFileSync('src/upstream/elements.js', 'utf8');
    expect(detailedModelsPlugin(false).transform(code, resolve('src/upstream/elements.js'))).toBeNull();
    expect(transformDetailedSource('unchanged', '/src/upstream/environment.js')).toBeNull();
    expect(() => transformDetailedSource(code.replace('export function makeLens(', 'function changed('), resolve('src/upstream/elements.js'))).toThrow('expected one anchor');
  });
  it.each(Object.entries(typeNames))('%s has finite dedicated visuals, correctly mapped picking, and no added tracing surfaces', (type, factory) => {
    const el = detailed[factory](); el.mesh.scale.set(3, 3, 3); applyDetailedElement(el);
    const holder = createDetailedHardware(el.mesh, { kind: type, width: el.mesh.geometry.parameters.width, height: el.mesh.geometry.parameters.height });
    const meshes: any[] = []; el.mesh.traverse((m: any) => { if (m.userData.isDetailedModel && m.isMesh) meshes.push(m); });
    expect(meshes.length).toBeGreaterThan(1);
    for (const part of meshes) {
      expect(part.userData.isVisualOnly).toBe(true);
      expect(part.userData.attachTarget).toBe(el.mesh);
      expect(Array.from(part.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(el._surfaceMeshes ?? []).not.toContain(part);
    }
    if (!['grating', 'multimeter', 'beamBlock'].includes(type)) expect(holder.userData.hasThroughAperture).toBe(true);
  });
  it('covers every installed library preset without extending the package schema', () => {
    for (const id of ['polarization', 'geometric-optics', 'gaussian-beams']) {
      const lib = JSON.parse(readFileSync(`optics-libraries/${id}/library.json`, 'utf8'));
      for (const p of lib.presets) {
        const el = detailed[(typeNames as any)[p.factory]](p.params);
        expect(el.mesh.getObjectByName('bb-detailed-optic')).toBeTruthy();
        for (const [key, value] of Object.entries(p.params)) expect(el.props[key]).toEqual(value);
      }
    }
  });
  it.each(['thickLens', 'mirror'])('keeps %s physical surface vertices and identities unchanged', type => {
    const el = native[(typeNames as any)[type]](type === 'mirror' ? { flat: false, R: -.2 } : {});
    const surfaces = [...el._surfaceMeshes];
    const positions = surfaces.map((s: any) => Array.from(s.geometry.attributes.position.array));
    applyDetailedElement(el);
    expect(el._surfaceMeshes).toEqual(surfaces);
    expect(surfaces.map((s: any) => Array.from(s.geometry.attributes.position.array))).toEqual(positions);
  });
  it('updates lens sign and thick-lens depth without accumulating model groups or geometries', () => {
    const lens = detailed.makeLens({ f: .05 });
    const first = lens.mesh.getObjectByName('bb-detailed-optic'); let disposed = 0;
    first.traverse((p: any) => p.geometry?.addEventListener('dispose', () => disposed++));
    lens.props.f = -.05; detailed.updateElementLabel(lens);
    expect(disposed).toBeGreaterThan(0);
    expect(lens.mesh.children.filter((g: any) => g.name === 'bb-detailed-optic')).toHaveLength(1);
    const thick = detailed.makeThickLens(); thick.mesh.scale.set(3, 2, 4);
    createDetailedHardware(thick.mesh, { kind: 'thickLens' });
    for (let i = 0; i < 5; i++) { thick.props.thickness = .004 + i * .001; detailed.refreshThickLensVisual(thick); }
    expect(thick.mesh.children.filter((g: any) => g.name === 'bb-detailed-optic')).toHaveLength(1);
    thick.mesh.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(thick.mesh.getObjectByName('bb-detailed-hardware-thickLens'));
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(thick.props.thickness);
  });
  it('releases detailed geometry when an element is removed from its scene', () => {
    const el = detailed.makePolarizer(), scene = new THREE.Scene(); scene.add(el.mesh);
    const pickingDisposed = vi.spyOn(el.mesh.geometry, 'dispose');
    let disposed = 0; el.mesh.traverse((p: any) => { if (p.userData.bbOwnedGeometry) p.geometry.addEventListener('dispose', () => disposed++); });
    scene.remove(el.mesh); expect(disposed).toBeGreaterThan(0); expect(pickingDisposed).toHaveBeenCalledOnce();
  });
  it('refreshes the PBS rim reference when its transmitted polarization is changed', () => {
    const el = detailed.makeBeamSplitter({ polarizing: true, polTransmit: 'Vertical' });
    const before = el.mesh.getObjectByName('bb-detailed-optic');
    el.props.polTransmit = 'Horizontal'; detailed.updateElementLabel(el);
    expect(el.mesh.getObjectByName('bb-detailed-optic')).not.toBe(before);
  });
  it('supports the source head and stand variants without moving the native stand', () => {
    const source = new THREE.Group(); const hardware = createDetailedHardware(source, { kind: 'source', width: .003, height: .003 });
    expect(hardware.userData.hasThroughAperture).toBe(false);
    const stand = createStand(), position = stand.position.clone(); decorateDetailedStand(stand);
    expect(stand.position.equals(position)).toBe(true); expect(stand.getObjectByName('bb-detailed-stand')).toBeTruthy();
    disposeDetailed(source); disposeDetailed(stand);
  });
});

describe('Detailed UGI shaft joins the unchanged ball and picking sphere', () => {
  const variants = [
    ['polarizer', 'makePolarizer', {}], ['HWP', 'makeWaveplate', { type: 'HWP', delta: Math.PI }],
    ['QWP', 'makeWaveplate', { type: 'QWP', delta: Math.PI / 2 }], ['Custom', 'makeWaveplate', { type: 'Custom', delta: 1 }],
  ] as const;
  const cases = variants.flatMap(([name, factory, props]) => [0, 45, 90, 180, -60].map(angle => ({ name, factory, props, angle })));
  it.each(cases)('$name at $angle degrees stays joined under tilt and nonuniform scaling', ({ factory, props, angle }) => {
    const old = native[factory]({ ...props, axisDeg: angle }), fixed = detailed[factory]({ ...props, axisDeg: angle });
    const rod = fixed.ugi.group.children.find((p: any) => p.geometry?.type === 'CylinderGeometry');
    const oldRod = old.ugi.group.children.find((p: any) => p.geometry?.type === 'CylinderGeometry');
    expect(oldRod.geometry.parameters.height).toBeCloseTo(.0045, 12);
    expect(rod.geometry.parameters.height).toBeCloseTo(.0063, 12);
    expect(fixed.ugi.ball.position.toArray()).toEqual(old.ugi.ball.position.toArray());
    expect(fixed.ugi.ball.geometry.parameters).toEqual(old.ugi.ball.geometry.parameters);
    expect(fixed.ugi.handle.position.toArray()).toEqual(old.ugi.handle.position.toArray());
    expect(fixed.ugi.handle.geometry.parameters).toEqual(old.ugi.handle.geometry.parameters);
    expect(fixed.ugi.handle.userData.element).toBe(fixed);
    for (const scale of [[3, 3, 3], [3, 1.7, 2.4]]) {
      fixed.mesh.scale.fromArray(scale); fixed.mesh.position.set(.012, .016, -.04);
      fixed.mesh.rotation.set(.45, -.35, .2); fixed.mesh.updateMatrixWorld(true);
      const ball = fixed.ugi.ball.getWorldPosition(new THREE.Vector3());
      const ends = [-1, 1].map(sign => rod.localToWorld(new THREE.Vector3(0, sign * rod.geometry.parameters.height / 2, 0)));
      expect(Math.min(...ends.map(p => p.distanceTo(ball)))).toBeLessThan(1e-12);
      expect(fixed.ugi.handle.getWorldPosition(new THREE.Vector3()).distanceTo(ball)).toBeLessThan(1e-12);
    }
  });
  it('updates shaft and ball together through the existing angle setter', () => {
    const el = detailed.makeWaveplate(); el.mesh.scale.set(3, 3, 3);
    for (const angle of [0, 45, 90, -90, 180]) {
      el.ugi.setAngle(angle); el.mesh.updateMatrixWorld(true);
      const ball = el.ugi.ball.getWorldPosition(new THREE.Vector3());
      expect(ball.x).toBeCloseTo(.0063 * 3 * Math.cos(angle * Math.PI / 180), 10);
      expect(ball.y).toBeCloseTo(.0063 * 3 * Math.sin(angle * Math.PI / 180), 10);
    }
  });
});

function simulate(data: any) {
  const world = new THREE.Scene();
  const elements = data.elements.map((item: any) => {
    const el = detailed[(typeNames as any)[item.type]](item.props);
    el.mesh.position.fromArray(item.position); el.mesh.quaternion.fromArray(item.quaternion); el.mesh.scale.fromArray(item.scale);
    if (item.type === 'mirror') detailed.refreshMirrorVisual(el);
    if (item.type === 'thickLens') detailed.refreshThickLensVisual(el);
    world.add(el.mesh); return el;
  });
  const sources = data.sources.map((s: any) => { const group = new THREE.Group(); group.position.fromArray(s.position); group.quaternion.fromArray(s.quaternion); world.add(group); return { group, props: { ...s.props } }; });
  world.updateMatrixWorld(true);
  const context: any = { sources, elements, params: { maxSegments: 60, beamWidthScale: 1, showPolarization: false },
    beamGroup: new THREE.Group(), polGroup: new THREE.Group(), tcontrols: { object: null }, ribbonMeshes: [],
    gratingLastInfo: new Map(), meterLastInfo: new Map(), elementLastInfo: new Map(), syncSourceW0ZR() {}, clampToPlaneXZ() {} };
  propagation.recompute(context); return context;
}

describe('Detailed front absorbing detector', () => {
  const sample = () => JSON.parse(readFileSync('library-packages/gaussian-beams/examples/near-collimation.json', 'utf8'));
  it('uses local -Z for its receiving face even after rotation', () => {
    expect(detectorFrontAccepts(new THREE.Vector3(0, 0, 1), new THREE.Quaternion())).toBe(true);
    expect(detectorFrontAccepts(new THREE.Vector3(0, 0, 1), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI))).toBe(false);
  });
  it('reads only the front and terminates rays before a downstream detector; clears stale readings', () => {
    const data = sample(); const second = structuredClone(data.elements[1]); second.position[2] = .2; data.elements.push(second);
    const result = simulate(data); const front = result.elements[1], downstream = result.elements[2];
    expect(result.meterLastInfo.has(front.id)).toBe(true); expect(result.meterLastInfo.has(downstream.id)).toBe(false);
    front.mesh.rotation.y = Math.PI; front.mesh.updateMatrixWorld(true); propagation.recompute(result);
    expect(result.meterLastInfo.size).toBe(0);
    result.sources.length = 0; propagation.recompute(result); expect(result.meterLastInfo.size).toBe(0);
  });
  it('maps the displayed receiving radius to world units after scaling', () => {
    const detector = detailed.makeMultimeter(); detector.mesh.scale.set(3, 3, 3); prepareDetailedPropagation([detector]);
    expect(detector.props.apertureRadius_m).toBeCloseTo(.0034 * .46 * 3, 12);
  });
  it.each([false, true])('structured trace agrees with rotated=%s front test and accounts for absorbed power', rotated => {
    const scene: any = { revision: 1, elements: [
      { uuid: 's', kind: 'source', active: true, pose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] }, props: { wavelength_nm: 530, intensity_rel: 1, polPreset: 'H', forward_cm: 100, backward_cm: 0 } },
      { uuid: 'd', kind: 'detector', active: true, pose: { position: [0, 0, .1], orientation: rotated ? [0, 1, 0, 0] : [0, 0, 0, 1] }, props: { detectorMode: 'front-absorbing', apertureRadius_m: .005 } },
    ] };
    const trace = detailedTrace.computeTrace(scene);
    expect(trace.arrivals.find((a: any) => a.destinationId === 'd').detectedPower).toBeCloseTo(rotated ? 0 : 1, 8);
    expect(trace.summary.energyConserved).toBe(true);
  });
  it.each(['near-collimation', 'keplerian-expander', 'galilean-expander'])('preserves the measured Gaussian result for %s', name => {
    const data = JSON.parse(readFileSync(`library-packages/gaussian-beams/examples/${name}.json`, 'utf8'));
    const context = simulate(data), meter = context.elements.at(-1);
    expect(context.meterLastInfo.get(meter.id).Irel).toBeCloseTo(1, 8);
    if (name !== 'near-collimation') expect(context.meterLastInfo.get(meter.id).w_um).toBeGreaterThan(3990);
  });
  it.each(['converging-diverging', 'thick-lenses', 'curved-mirrors'])('runs the unchanged geometric propagation for %s', name => {
    const data = JSON.parse(readFileSync(`library-packages/geometric-optics/examples/${name}.json`, 'utf8'));
    expect(simulate(data).elementLastInfo.size).toBeGreaterThan(0);
  });
});
