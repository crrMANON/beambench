import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const evidence = 'artifacts/detailed-models-20261024';
const specimen = (type: string, props: any = {}) => ({ type, props, position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [3, 3, 3] });
const empty = () => ({ params: { beamWidthScale: 1, showGrid: true, showLabels: false, labelFontSize: 1 }, sources: [], elements: [], ruler: null });
const cases: [string, string, any][] = [
  ['positive-lens', 'lens', { f: .05 }], ['negative-lens', 'lens', { f: -.05 }],
  ['biconvex', 'thickLens', { R1: .05, R2: -.05, thickness: .004 }], ['biconcave', 'thickLens', { R1: -.05, R2: .05, thickness: .004 }],
  ['flat-mirror', 'mirror', { flat: true }], ['concave-mirror', 'mirror', { flat: false, R: .2 }], ['convex-mirror', 'mirror', { flat: false, R: -.2 }],
  ['polarizer', 'polarizer', { axisDeg: 45 }], ['half-wave', 'waveplate', { type: 'HWP', delta: Math.PI, axisDeg: 22.5 }],
  ['quarter-wave', 'waveplate', { type: 'QWP', delta: Math.PI / 2, axisDeg: 45 }], ['custom-wave', 'waveplate', { type: 'Custom', delta: 1, axisDeg: 60 }],
  ['faraday', 'faraday', { phiDeg: 45 }], ['beam-splitter', 'beamSplitter', { polarizing: false }], ['pbs', 'beamSplitter', { polarizing: true, polTransmit: 'Vertical' }],
  ['reflective-grating', 'grating', { mode: 'reflective' }], ['transmissive-grating', 'grating', { mode: 'transmissive' }],
  ['beam-block', 'beamBlock', {}], ['detector', 'multimeter', {}],
];
async function open(page: Page, file: string) {
  await page.goto(pathToFileURL(resolve(file)).href);
  await page.waitForFunction(() => (window as any).__beambench?.version === 1);
}
async function load(page: Page, data: any) {
  await page.locator('input[type=file]').setInputFiles({ name: 'models.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.waitForFunction(count => (window as any).__beambench.elementCount() === count, data.elements.length + data.sources.length);
  // Native restore finishes its history transaction after 50 ms.
  await page.waitForTimeout(90);
}
async function save(page: Page) {
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '保存场景', exact: true }).click();
  return JSON.parse(readFileSync((await (await downloaded).path())!, 'utf8'));
}

test.describe('original visual protection', () => {
  test('original default build remains exactly equal to the pre-change image', async ({ browser }) => {
    mkdirSync(`${evidence}/baseline/dist`, { recursive: true });
    writeFileSync(`${evidence}/baseline/dist/beambench-standalone.html`, gunzipSync(readFileSync('tests/fixtures/pre-detailed-standalone.html.gz')));
    const capture = async (path: string, name: string) => {
      const page = await browser.newPage();
      await page.addInitScript(() => { let time = 0; Object.defineProperty(performance, 'now', { value: () => time }); (window as any).__visualTime = () => { time = 1000; }; });
      await open(page, path);
      await page.evaluate(async () => { (window as any).__visualTime(); await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); });
      await page.locator('#bb-build').evaluate(node => { node.textContent = 'BUILD_TIMESTAMP'; });
      const image = await page.screenshot({ path: `${evidence}/${name}.png` });
      const camera = await page.evaluate(() => (window as any).__beambench.cameraState());
      await page.close(); return { image, camera };
    };
    const baseline = await capture(`${evidence}/baseline/dist/beambench-standalone.html`, 'original-before');
    const current = await capture('dist/beambench-standalone.html', 'original-after');
    expect(current.camera).toEqual(baseline.camera);
    expect(current.image.equals(baseline.image)).toBe(true);
  });
});

test('all instrument variants have front/back/side review images and preserve old-file restoration', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, 'dist-basic-detailed/beambench-standalone.html');
  await expect(page.locator('.pal-item')).toHaveCount(26);
  await page.getByRole('checkbox', { name: '显示偏振', exact: true }).uncheck();
  const gallery = `${evidence}/gallery`; mkdirSync(gallery, { recursive: true });
  const original = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await open(original, 'dist-basic/beambench-standalone.html');
  await original.getByRole('checkbox', { name: '显示偏振', exact: true }).uncheck();
  const results = [];
  for (const [id, type, props] of cases) {
    const scene: any = empty(); scene.elements = [specimen(type, props)]; await load(page, scene);
    await load(original, scene);
    for (const [name, target] of [['original', original], ['detailed', page]] as const) {
      await target.evaluate(type => (window as any).__beambench.focusElement(type, -1, .035), type);
      await target.screenshot({ path: `${gallery}/${id}-${name}.png`, clip: { x: 460, y: 200, width: 520, height: 650 } });
    }
    const audit = await page.evaluate(() => (window as any).__beambench.modelAudit());
    expect(audit[0].detailedNodes).toBeGreaterThan(0);
    expect(audit[0].bounds.flat().every(Number.isFinite)).toBe(true);
    for (const view of ['front', 'back', 'side']) {
      await page.evaluate(({ type, view }) => (window as any).__beambench.focusModel(type, view), { type, view });
      await page.screenshot({ path: `${gallery}/${id}-${view}.png`, clip: { x: 460, y: 200, width: 520, height: 650 } });
    }
    results.push({ id, type, audit: audit[0] });
  }
  for (const mode of ['gaussian', 'rays']) {
    const scene: any = empty();
    const source = JSON.parse(readFileSync('library-packages/gaussian-beams/examples/near-collimation.json', 'utf8')).sources[0];
    source.position = [0, 0, 0]; source.props.beamMode = mode; source.props.forward_cm = 2;
    scene.sources.push(source); await load(page, scene);
    await load(original, scene);
    for (const [name, target] of [['original', original], ['detailed', page]] as const) {
      await target.evaluate(() => (window as any).__beambench.setView('side'));
      await target.screenshot({ path: `${gallery}/source-${mode}-${name}.png` });
    }
    for (const view of ['front', 'back', 'side']) {
      await page.evaluate(view => (window as any).__beambench.focusModel('source', view), view);
      await page.screenshot({ path: `${gallery}/source-${mode}-${view}.png`, clip: { x: 460, y: 200, width: 520, height: 650 } });
    }
    results.push({ id: `source-${mode}`, type: 'source', audit: await page.evaluate(() => (window as any).__beambench.modelAudit()) });
  }
  writeFileSync(`${evidence}/model-audit.json`, JSON.stringify({ cases: results, pageErrors: errors }, null, 2));
  await original.close();
  expect(errors).toEqual([]);
});

test('detailed presets support native drag, undo, redo and restore into both model profiles', async ({ page }) => {
  await open(page, 'dist-basic-detailed/beambench-standalone.html');
  await page.getByRole('checkbox', { name: '显示偏振', exact: true }).uncheck();
  await page.evaluate(() => (window as any).__beambench.setView('bench'));
  const button = await page.locator('[data-type="geometric-optics:biconcave"]').boundingBox();
  const point = await page.evaluate(() => (window as any).__beambench.screenPointForWorld(-.1, -.1));
  await page.mouse.move(button!.x + button!.width / 2, button!.y + button!.height / 2); await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 4 }); await page.mouse.up();
  let saved = await save(page); expect(saved.elements.filter((e: any) => e.type === 'thickLens')).toHaveLength(1);
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(90);
  expect((await save(page)).elements.filter((e: any) => e.type === 'thickLens')).toHaveLength(0);
  await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(90);
  saved = await save(page); expect(saved.elements.filter((e: any) => e.type === 'thickLens')).toHaveLength(1);
  await load(page, saved); expect((await page.evaluate(() => (window as any).__beambench.modelAudit())).find((e: any) => e.type === 'thickLens').roundHolder).toBe(true);
  await open(page, 'dist-basic/beambench-standalone.html'); await load(page, saved);
  expect((await save(page)).elements.find((e: any) => e.type === 'thickLens').props.R1).toBe(-.05);
});

test('detailed detector has front-only readings, absorbs downstream paths, and clears stale readings', async ({ page }) => {
  await open(page, 'dist-detailed/beambench-standalone.html'); await expect(page.locator('.pal-item')).toHaveCount(30);
  await page.getByRole('checkbox', { name: '显示偏振', exact: true }).uncheck();
  const data = JSON.parse(readFileSync('library-packages/gaussian-beams/examples/near-collimation.json', 'utf8'));
  const second = structuredClone(data.elements[1]); second.position[2] = .2; data.elements.push(second);
  await load(page, data);
  let meters = await page.evaluate(() => (window as any).__beambench.detectorReadings());
  expect(meters[0].reading.Irel).toBeCloseTo(1, 8); expect(meters[1].reading).toBeNull();
  data.elements[1].quaternion = [0, 1, 0, 0]; await load(page, data);
  meters = await page.evaluate(() => (window as any).__beambench.detectorReadings());
  expect(meters.every((m: any) => m.reading === null)).toBe(true);
  data.sources = []; await load(page, data);
  expect((await page.evaluate(() => (window as any).__beambench.detectorReadings())).every((m: any) => m.reading === null)).toBe(true);
  const observation = await page.evaluate(() => { const b = (window as any).__beambench; b.syncNow(); return b.observe(); });
  writeFileSync(`${evidence}/detector-observation.json`, JSON.stringify(observation, null, 2));
});

test('mixed bench performance and repeated loading retain bounded renderer resources', async ({ browser }) => {
  const bench: any = empty(); bench.elements = Object.keys({ lens: 1, thickLens: 1, mirror: 1, polarizer: 1, waveplate: 1, faraday: 1, beamSplitter: 1, grating: 1, beamBlock: 1, multimeter: 1 })
    .map((type, i) => ({ ...specimen(type), position: [(i % 5 - 2) * .07, 0, (Math.floor(i / 5) - 1) * .07] }));
  const samples: any = {};
  for (const profile of ['original', 'detailed']) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      (window as any).__drawCalls = 0;
      for (const ctor of [WebGLRenderingContext, WebGL2RenderingContext]) for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const proto = ctor.prototype as any, original = proto[method];
        if (original) proto[method] = function (...args: any[]) { (window as any).__drawCalls++; return original.apply(this, args); };
      }
    });
    await open(page, profile === 'original' ? 'dist/beambench-standalone.html' : 'dist-detailed/beambench-standalone.html');
    await page.getByRole('checkbox', { name: '显示偏振', exact: true }).uncheck(); await load(page, bench);
    await page.evaluate(() => (window as any).__beambench.setView('bench'));
    const measure = async () => page.evaluate(async () => {
      const times: number[] = []; let previous = performance.now(), warmup = 20;
      (window as any).__drawCalls = 0;
      await new Promise<void>(done => { const frame = (now: number) => { if (warmup-- <= 0) times.push(now - previous); previous = now; if (times.length < 80) requestAnimationFrame(frame); else done(); }; requestAnimationFrame(frame); });
      const sorted = [...times].sort((a, b) => a - b);
      return { medianMs: sorted[Math.floor(sorted.length / 2)], meanMs: times.reduce((a, b) => a + b) / times.length,
        drawCallsPerFrame: (window as any).__drawCalls / 100, memory: (window as any).__beambench.rendererInfo() };
    });
    const before = await measure();
    for (let i = 0; i < 4; i++) { await load(page, empty()); await load(page, bench); }
    const after = await measure(); samples[profile] = { before, after };
    writeFileSync(`${evidence}/performance.json`, JSON.stringify(samples, null, 2));
    if (profile === 'detailed') {
      expect(after.memory.geometries).toBeLessThanOrEqual(before.memory.geometries + 2);
      expect(after.memory.textures).toBeLessThanOrEqual(before.memory.textures + 2);
      await page.screenshot({ path: `${evidence}/mixed-detailed.png` });
    } else await page.screenshot({ path: `${evidence}/mixed-original.png` });
    await page.close();
  }
  writeFileSync(`${evidence}/performance.json`, JSON.stringify(samples, null, 2));
  // Timing is documented separately: vsync/headless contention is not an assertion of GPU speed.
});

test('UGI shafts remain joined in full-handle views and support ball dragging, undo, redo and reload', async ({ page }) => {
  const output = 'artifacts/ugi-connection-20261024'; mkdirSync(output, { recursive: true });
  const variants = [
    ['polarizer', 'polarizer', { axisDeg: 45 }],
    ['half-wave', 'waveplate', { type: 'HWP', delta: Math.PI, axisDeg: 22.5 }],
    ['quarter-wave', 'waveplate', { type: 'QWP', delta: Math.PI / 2, axisDeg: 45 }],
    ['custom-wave', 'waveplate', { type: 'Custom', delta: 1, axisDeg: -60 }],
  ] as const;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const results = [];
  for (const [id, type, props] of variants) {
    await open(page, 'dist-basic-detailed/beambench-standalone.html');
    const data: any = empty(); data.elements = [specimen(type, props)]; await load(page, data);
    for (const view of ['front', 'back', 'side']) {
      await page.evaluate(({ type, view }) => (window as any).__beambench.focusModel(type, view, .085), { type, view });
      // Full viewport deliberately includes the complete shaft and ball, unlike the old close crops.
      await page.screenshot({ path: `${output}/${id}-${view}.png` });
    }
    await page.evaluate(type => (window as any).__beambench.focusModel(type, 'front', .085), type);
    const point = async (angle: number) => page.evaluate(angle => {
      const theta = angle * Math.PI / 180;
      return (window as any).__beambench.screenPoint3D(.0063 * 3 * Math.cos(theta), .0063 * 3 * Math.sin(theta), .00012 * 3);
    }, angle);
    const start = await point(props.axisDeg), target = await point(90);
    // Confirm the ball and the intended drag target are visible, without crossing UI panels.
    for (const p of [start, target]) { expect(p.x).toBeGreaterThan(255); expect(p.x).toBeLessThan(1055); expect(p.y).toBeGreaterThan(60); expect(p.y).toBeLessThan(950); }
    // Native file restoration suppresses pushHistory while restoring. Establish
    // the initial interaction state through a real ball click before the drag.
    await page.mouse.click(start.x, start.y);
    const initialAngle = (await save(page)).elements[0].props.axisDeg;
    expect(Math.abs(initialAngle - props.axisDeg)).toBeLessThan(1);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
    let saved = await save(page); const angle = saved.elements[0].props.axisDeg;
    expect(Math.abs(angle - 90)).toBeLessThan(1);
    await page.screenshot({ path: `${output}/${id}-dragged.png` });
    await page.keyboard.press('Meta+z'); await page.waitForTimeout(90);
    expect((await save(page)).elements[0].props.axisDeg).toBeCloseTo(initialAngle, 8);
    await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(90);
    saved = await save(page); expect(saved.elements[0].props.axisDeg).toBeCloseTo(angle, 8);
    // Both detailed palette profiles use the same corrected model adapter.
    await open(page, 'dist-detailed/beambench-standalone.html'); await load(page, saved);
    expect((await save(page)).elements[0].props.axisDeg).toBeCloseTo(angle, 8);
    expect((await page.evaluate(() => (window as any).__beambench.modelAudit()))[0].detailedNodes).toBeGreaterThan(0);
    results.push({ id, configuredAngle: props.axisDeg, initialInteractionAngle: initialAngle, draggedAngle: angle, undoRedoReload: 'passed' });
  }
  writeFileSync(`${output}/browser-ugi.json`, JSON.stringify({ cases: results, pageErrors: errors }, null, 2));
  expect(errors).toEqual([]);
});
