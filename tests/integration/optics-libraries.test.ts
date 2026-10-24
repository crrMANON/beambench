import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { validateLibrary, loadLibraries } from '../../tools/optics-libraries.mjs';
import { createPreset, presetCatalog, waveplateParams, type OpticalLibrary } from '../../src/library/presets';
import { mapElementProps } from '../../src/integration/upstream-scene';

const pack = JSON.parse(readFileSync('library-packages/polarization/library.json', 'utf8')) as OpticalLibrary;
const catalog = presetCatalog([pack]);

describe('Data-only library installation', () => {
  it('validates the standalone seven-preset pack and namespaces native types', () => {
    expect(validateLibrary(pack)).toEqual(pack);
    expect(catalog.size).toBe(7);
    expect(catalog.has('polarization:quarter-wave')).toBe(true);
    expect(catalog.has('waveplate')).toBe(false);
  });

  it.each([
    ['unsupported API', (p: any) => { p.apiVersion = 2; }, 'apiVersion'],
    ['non-string identifier', (p: any) => { p.id = ['polarization']; }, 'id'],
    ['duplicate preset', (p: any) => { p.presets.push(p.presets[0]); }, '.id'],
    ['unknown factory', (p: any) => { p.presets[0].factory = 'script'; }, '.factory'],
    ['script hook', (p: any) => { p.script = 'evil.js'; }, 'script'],
    ['unknown parameter', (p: any) => { p.presets[0].params.geometry = 'new'; }, 'geometry'],
    ['missing parameter', (p: any) => { delete p.presets[0].params.axisDeg; }, 'axisDeg'],
    ['nonfinite parameter', (p: any) => { p.presets[0].params.axisDeg = Infinity; }, 'axisDeg'],
    ['out of range', (p: any) => { p.presets[5].params.R = 2; }, '.R'],
    ['wrong boolean', (p: any) => { p.presets[5].params.polarizing = 'true'; }, 'polarizing'],
  ])('rejects %s with an actionable field', (_label, edit, field) => {
    const candidate = structuredClone(pack); edit(candidate);
    expect(() => validateLibrary(candidate, 'installed/library.json')).toThrow(field);
  });

  it('supports install/remove and rejects duplicate package identities or missing manifests', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bb-libraries-'));
    try {
      expect(loadLibraries(directory)).toEqual([]);
      mkdirSync(join(directory, 'polarization'));
      writeFileSync(join(directory, 'polarization/library.json'), JSON.stringify(pack));
      expect(loadLibraries(directory)).toEqual([pack]);
      mkdirSync(join(directory, 'duplicate'));
      expect(() => loadLibraries(directory)).toThrow('missing manifest');
      writeFileSync(join(directory, 'duplicate/library.json'), JSON.stringify(pack));
      expect(() => loadLibraries(directory)).toThrow('duplicate library id');
      rmSync(join(directory, 'duplicate'), { recursive: true });
      rmSync(join(directory, 'polarization'), { recursive: true });
      expect(loadLibraries(directory)).toEqual([]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('Original visual boundary', () => {
  it('keeps original markup, scene assets, rendering and physics unchanged', () => {
    const hashes = JSON.parse(readFileSync('tests/fixtures/original-visual-hashes.json', 'utf8'));
    for (const [file, expected] of Object.entries(hashes.files)) {
      expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(expected);
    }
    const main = readFileSync('src/upstream/main.js', 'utf8');
    for (const section of hashes.sections) {
      const start = main.indexOf(section.start);
      const end = main.indexOf(section.end, start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(createHash('sha256').update(main.slice(start, end)).digest('hex'), section.start).toBe(section.sha256);
    }
  });
});

// Canvas rendering is stubbed; native Three.js geometry and native Jones methods run unchanged.
describe('Native polarization preset experiments', () => {
  let native: any;
  const context = new Proxy({
    measureText: () => ({ width: 100 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} });
  beforeAll(async () => {
    vi.stubGlobal('document', {
      body: { appendChild() {} },
      createElement: () => ({ getContext: () => context, style: {}, addEventListener() {}, click() {} }),
    });
    native = await import('../../src/upstream/elements.js');
  });
  afterAll(() => vi.unstubAllGlobals());
  const factories = () => ({ polarizer: native.makePolarizer, waveplate: native.makeWaveplate,
    faraday: native.makeFaraday, beamSplitter: native.makeBeamSplitter, multimeter: native.makeMultimeter });
  const power = (j: any[]) => j.reduce((sum, c) => sum + c.re ** 2 + c.im ** 2, 0);
  const beam = { dir: new THREE.Vector3(0, 0, 1) };

  it('creates original native objects with exact QWP and PBS parameters', () => {
    const qwp: any = createPreset(catalog.get('polarization:quarter-wave')!, factories());
    expect(qwp.type).toBe('waveplate');
    expect(qwp.props).toMatchObject({ type: 'QWP', delta: Math.PI / 2, axisDeg: 45 });
    const pbs: any = createPreset(catalog.get('polarization:pbs')!, factories());
    expect(pbs.type).toBe('beamSplitter');
    expect(pbs.props).toMatchObject({ polarizing: true, polTransmit: 'Vertical', R: 0.5 });
    const mapped = mapElementProps('waveplate', qwp.props);
    expect(waveplateParams(JSON.parse(JSON.stringify(mapped)))).toEqual({ type: 'QWP', delta: Math.PI / 2, axisDeg: 45 });
    expect(waveplateParams({ fastAxisAngleDeg: 0 })).toEqual({ type: 'HWP', delta: Math.PI, axisDeg: 0 });
    expect(waveplateParams({ type: 'QWP', delta: 0, fastAxisAngleDeg: 0 }).delta).toBe(0);
  });

  it.each(['malus', 'half-wave', 'quarter-wave'])('%s example has expected native Jones transmission', async (name) => {
    const { Complex } = await import('../../src/upstream/optics.js?v=1.0.15');
    const scene = JSON.parse(readFileSync(`library-packages/polarization/examples/${name}.json`, 'utf8'));
    const nativeFactories: any = { polarizer: native.makePolarizer, waveplate: native.makeWaveplate, multimeter: native.makeMultimeter };
    let j = [new Complex(1, 0), new Complex(0, 0)];
    for (const item of scene.elements) {
      const el = nativeFactories[item.type](item.props);
      if (el.jones) j = el.jones(j, beam);
    }
    expect(power(j)).toBeCloseTo(0.5, 10);
  });

  it('crossed polarizers extinguish, while circular output is independent of analyzer angle', async () => {
    const { Complex } = await import('../../src/upstream/optics.js?v=1.0.15');
    const j = [new Complex(1, 0), new Complex(0, 0)];
    expect(power(native.makePolarizer({ axisDeg: 90 }).jones(j, beam))).toBeCloseTo(0, 10);
    const qwp = createPreset<any>(catalog.get('polarization:quarter-wave')!, factories());
    const circular = qwp.jones(j, beam);
    expect(power(circular)).toBeCloseTo(1, 10);
    for (const angle of [0, 30, 45, 90, 135]) {
      expect(power(native.makePolarizer({ axisDeg: angle }).jones(circular, beam))).toBeCloseTo(0.5, 10);
    }
  });

  it('native save/load and undo/redo preserve QWP and PBS without an installed library', async () => {
    const state = await import('../../src/upstream/state.js');
    vi.useFakeTimers();
    const elements: any[] = [];
    const selectable: any[] = [];
    const scene = new THREE.Scene();
    const addElement = (element: any, position: THREE.Vector3) => {
      element.mesh.position.copy(position);
      elements.push(element); selectable.push(element.mesh); scene.add(element.mesh);
      return element;
    };
    state.init({
      params: { beamWidthScale: 1, showGrid: true, showLabels: true, labelFontSize: 1 },
      sources: [], elements, selectable, ugiPickables: [], scene, grid: { visible: true },
      tcontrols: { detach() {} }, addElement,
      Ruler: { getRuler: () => null, doesRulerExist: () => false },
      GizmoUI: { correctLabelScale() {} }, doRecompute() {}, refreshSelectedUI() {},
      recreateFuncs: { waveplate: native.makeWaveplate, beamSplitter: native.makeBeamSplitter },
    });
    let blob: Blob | undefined;
    const url = vi.spyOn(URL, 'createObjectURL').mockImplementation((input) => { blob = input as Blob; return 'blob:test'; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const qwp = addElement(createPreset<any>(catalog.get('polarization:quarter-wave')!, factories()), new THREE.Vector3());
      addElement(createPreset<any>(catalog.get('polarization:pbs')!, factories()), new THREE.Vector3(0, 0, 0.1));
      state.pushHistory();
      qwp.props.axisDeg = 15; state.pushHistory();
      state.undo(); await vi.runAllTimersAsync();
      expect(elements[0].props).toMatchObject({ type: 'QWP', delta: Math.PI / 2, axisDeg: 45 });
      state.redo(); await vi.runAllTimersAsync();
      expect(elements[0].props.axisDeg).toBe(15);
      state.saveState();
      const saved = JSON.parse(await blob!.text());
      // Restore only through original native factories, without reading the pack or catalog.
      state.restore(saved); await vi.runAllTimersAsync();
      expect(elements[0].props).toMatchObject({ type: 'QWP', delta: Math.PI / 2, axisDeg: 15 });
      expect(elements[1].props).toMatchObject({ polarizing: true, polTransmit: 'Vertical' });
      expect(saved.elements.every((e: any) => !JSON.stringify(e).includes('polarization:'))).toBe(true);
    } finally { url.mockRestore(); revoke.mockRestore(); vi.useRealTimers(); }
  });
});
