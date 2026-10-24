import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { validateLibrary, loadLibraries } from '../../tools/optics-libraries.mjs';
import { createPreset, mirrorParams, type OpticalLibrary } from '../../src/library/presets';
import { mapElementProps } from '../../src/integration/upstream-scene';

const ids = ['geometric-optics', 'gaussian-beams'];
const packs = ids.map(id => JSON.parse(readFileSync(`library-packages/${id}/library.json`, 'utf8')) as OpticalLibrary);
const entries = packs.flatMap(pack => pack.presets);
describe('Two independent optical libraries', () => {
  it('retains API 1 and delivers eight geometric and five Gaussian presets', () => {
    expect(packs.map(pack => validateLibrary(pack).presets.length)).toEqual([8, 5]);
    expect(entries.map(p => p.id)).toContain('negative-25');
  });
  it.each([
    ['lens', { f: 0 }], ['lens', { f: Infinity }],
    ['thickLens', { R1: 0, R2: -.05, n: 1.5, thickness: .004 }],
    ['thickLens', { R1: .05, R2: -.05, n: .5, thickness: .004 }],
    ['thickLens', { R1: .05, R2: -.05, n: 1.5, thickness: -.004 }],
    ['mirror', { flat: false, R: 0, refl: 1, n: 1.5, thickness: .00018 }],
    ['mirror', { flat: false, R: .2, refl: 1.1, n: 1.5, thickness: .00018 }],
  ])('rejects invalid %s parameters', (factory, params) => {
    expect(() => validateLibrary({ apiVersion: 1, id: 'invalid', name: 'invalid', version: '1.0.0', presets: [{ id: 'invalid', name: 'invalid', factory, params }] })).toThrow();
  });
  it('removes either library without a dependency on its sibling or polarization', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bb-expanded-'));
    try {
      for (const id of [...ids, 'polarization']) cpSync(`library-packages/${id}`, join(dir, id), { recursive: true });
      expect(loadLibraries(dir)).toHaveLength(3);
      rmSync(join(dir, 'geometric-optics'), { recursive: true });
      expect(loadLibraries(dir).map(p => p.id)).toEqual(['gaussian-beams', 'polarization']);
      rmSync(join(dir, 'gaussian-beams'), { recursive: true });
      expect(loadLibraries(dir).map(p => p.id)).toEqual(['polarization']);
      mkdirSync(join(dir, 'geometric-optics')); cpSync('library-packages/geometric-optics/library.json', join(dir, 'geometric-optics/library.json'));
      rmSync(join(dir, 'polarization'), { recursive: true });
      expect(loadLibraries(dir).map(p => p.id)).toEqual(['geometric-optics']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('Original factories and live propagation', () => {
  let native: any, propagation: any, Complex: any;
  const canvasContext = new Proxy({ measureText: () => ({ width: 100 }), createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
  beforeAll(async () => {
    vi.stubGlobal('document', { body: { appendChild() {} }, createElement: () => ({ getContext: () => canvasContext, style: {}, addEventListener() {}, click() {} }) });
    native = await import('../../src/upstream/elements.js');
    propagation = await import('../../src/upstream/propagation.js');
    ({ Complex } = await import('../../src/upstream/optics.js?v=1.0.15'));
  });
  afterAll(() => vi.unstubAllGlobals());
  function factories() { return { lens: native.makeLens, thickLens: native.makeThickLens, mirror: native.makeMirror,
    polarizer: native.makePolarizer, waveplate: native.makeWaveplate, faraday: native.makeFaraday,
    beamSplitter: native.makeBeamSplitter, multimeter: native.makeMultimeter }; }

  it.each(entries.map(p => [p.name, p] as const))('%s retains all native parameters after JSON/domain restoration', (_name, preset) => {
    const element = createPreset<any>(preset, factories());
    const saved = JSON.parse(JSON.stringify({ type: element.type, props: element.props }));
    const domain = mapElementProps(saved.type, saved.props);
    const props = saved.type === 'mirror' ? mirrorParams(domain) : saved.props;
    const restored = (factories() as any)[preset.factory](props);
    for (const [key, value] of Object.entries(preset.params)) expect(restored.props[key], key).toEqual(value);
    expect(saved.type.includes(':')).toBe(false);
  });

  it('preserves curved mirrors through the shared host creation/restoration mapping', () => {
    for (const R of [.2, -.2]) {
      expect(mirrorParams(mapElementProps('mirror', { flat: false, R, refl: .8, n: 1.7, thickness: .001 })))
        .toMatchObject({ flat: false, R, refl: .8, n: 1.7, thickness: .001 });
    }
    expect(mirrorParams({})).toMatchObject({ flat: true, R: 2, refl: 1 });
  });

  it('all thirteen presets survive native save/load and undo/redo with no library dependency', async () => {
    const state = await import('../../src/upstream/state.js');
    vi.useFakeTimers();
    const elements: any[] = [], selectable: any[] = []; const scene = new THREE.Scene();
    const addElement = (el: any, pos: THREE.Vector3) => { el.mesh.position.copy(pos); elements.push(el); selectable.push(el.mesh); scene.add(el.mesh); return el; };
    state.init({ params: { beamWidthScale: 1, showGrid: true, showLabels: true, labelFontSize: 1 },
      sources: [], elements, selectable, ugiPickables: [], scene, grid: { visible: true }, tcontrols: { detach() {} }, addElement,
      Ruler: { getRuler: () => null, doesRulerExist: () => false }, GizmoUI: { correctLabelScale() {} }, doRecompute() {}, refreshSelectedUI() {},
      recreateFuncs: factories(), refreshMirrorVisual: native.refreshMirrorVisual, refreshThickLensVisual: native.refreshThickLensVisual });
    let blob: Blob | undefined;
    const url = vi.spyOn(URL, 'createObjectURL').mockImplementation(input => { blob = input as Blob; return 'blob:test'; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const check = () => entries.forEach((preset, index) => {
      for (const [key, value] of Object.entries(preset.params)) expect(elements[index].props[key], `${preset.id}.${key}`).toEqual(value);
    });
    try {
      entries.forEach((preset, index) => addElement(createPreset<any>(preset, factories()), new THREE.Vector3(index * .03, 0, 0)));
      check(); state.pushHistory(); elements[0].props.f = .075; state.pushHistory();
      state.undo(); await vi.runAllTimersAsync(); check();
      state.redo(); await vi.runAllTimersAsync(); expect(elements[0].props.f).toBe(.075);
      state.undo(); await vi.runAllTimersAsync(); state.saveState();
      state.restore(JSON.parse(await blob!.text())); await vi.runAllTimersAsync(); check();
    } finally { url.mockRestore(); revoke.mockRestore(); vi.useRealTimers(); }
  });

  it.each([[.025, .1, .125, -4, .125, 0, -.25], [-.025, .1, .075, 4, .075, 0, .25]])(
    'native q propagation for f1=%s agrees with an independent telescope matrix', (f1, f2, L, A, B, C, D) => {
      const input = new Complex(.1, 5.9275);
      const first = native.makeLens({ f: f1 }).abcd(input);
      const actual = native.makeLens({ f: f2 }).abcd(first.add(L));
      // General complex division, independent of the native Complex and factory implementation.
      const nr = A * input.re + B, ni = A * input.im, dr = C * input.re + D, di = C * input.im;
      expect(actual.re).toBeCloseTo((nr * dr + ni * di) / (dr * dr + di * di), 9);
      expect(actual.im).toBeCloseTo((ni * dr - nr * di) / (dr * dr + di * di), 9);
    });

  function simulate(data: any) {
    const world = new THREE.Scene();
    const elements = data.elements.map((item: any) => {
      const el = (factories() as any)[item.type](item.props);
      el.mesh.position.fromArray(item.position); el.mesh.quaternion.fromArray(item.quaternion); el.mesh.scale.fromArray(item.scale);
      if (el.type === 'mirror') native.refreshMirrorVisual(el);
      if (el.type === 'thickLens') native.refreshThickLensVisual(el);
      world.add(el.mesh); return el;
    });
    const sources = data.sources.map((item: any) => {
      const group = new THREE.Group(); group.position.fromArray(item.position); group.quaternion.fromArray(item.quaternion); world.add(group);
      return { group, props: { ...item.props } };
    });
    world.updateMatrixWorld(true);
    const elementLastInfo = new Map(), meterLastInfo = new Map();
    propagation.recompute({ sources, elements, params: { maxSegments: 60, beamWidthScale: 1, showPolarization: false },
      beamGroup: new THREE.Group(), polGroup: new THREE.Group(), tcontrols: { object: null }, ribbonMeshes: [],
      gratingLastInfo: new Map(), meterLastInfo, elementLastInfo, syncSourceW0ZR() {}, clampToPlaneXZ() {} });
    return { elements, elementLastInfo, meterLastInfo };
  }
  const example = (id: string, name: string) => JSON.parse(readFileSync(`library-packages/${id}/examples/${name}.json`, 'utf8'));

  it.each(['keplerian-expander', 'galilean-expander'])('%s runs through the actual webpage propagation path', (name) => {
    const data = example('gaussian-beams', name), result = simulate(data);
    const meter = result.meterLastInfo.get(result.elements[2].id);
    expect(meter).toBeTruthy(); expect(meter.Irel).toBeCloseTo(1, 8);
    expect(meter.w_um).toBeGreaterThan(3990); expect(meter.w_um).toBeLessThan(4010);
    expect(meter.outgoingDir.z).toBeCloseTo(1, 8);
  });

  it('near-collimation reduces divergence over the supplied observation distance', () => {
    const data = example('gaussian-beams', 'near-collimation'), result = simulate(data);
    const meter = result.meterLastInfo.get(result.elements[1].id);
    const bare = structuredClone(data); bare.elements.shift(); const without = simulate(bare);
    expect(meter.w_um).toBeLessThan(without.meterLastInfo.get(without.elements[0].id).w_um / 2);
  });

  it.each(['lens', 'thickLens', 'mirror'])('native off-axis %s rays distinguish converging and diverging presets', (kind) => {
    const data = example('geometric-optics', kind === 'lens' ? 'converging-diverging' : kind === 'thickLens' ? 'thick-lenses' : 'curved-mirrors');
    const directions = data.elements.map((item: any) => {
      const source = structuredClone(data.sources[0]); source.position = [item.position[0] + .0005, 0, -.25]; source.props.rays_aperture_radius_mm = 0;
      const result = simulate({ sources: [source], elements: [item] });
      const info = result.elementLastInfo.get(result.elements[0].id); expect(info).toBeTruthy(); return info.outgoingDir;
    });
    expect(directions[0].x).toBeLessThan(0); expect(directions[1].x).toBeGreaterThan(0);
    if (kind === 'mirror') expect(directions.every((d: THREE.Vector3) => d.z < 0)).toBe(true);
  });
});
