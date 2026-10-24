import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const fixture = 'artifacts/modular-optics-v1/build-fixture';
async function open(page: Page, path: string) {
  await page.goto(pathToFileURL(resolve(path)).href);
  await page.waitForFunction(() => (window as any).__beambench?.version === 1);
}
async function save(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存场景', exact: true }).click();
  const path = await (await download).path();
  return JSON.parse(readFileSync(path!, 'utf8'));
}

test('default page matches original UI and visual baseline', async ({ browser }) => {
  const capture = async (path: string, label: string) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    // Freeze only the renderer's elapsed time, not browser timers or native history/file I/O.
    await page.addInitScript(() => {
      let elapsed = 0;
      Object.defineProperty(performance, 'now', { value: () => elapsed });
      (window as any).__setVisualElapsed = (value: number) => { elapsed = value; };
    });
    await open(page, path);
    await page.evaluate(async () => {
      (window as any).__setVisualElapsed(1000);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const items = await page.locator('.pal-item').allTextContents();
    const stats = await page.evaluate(() => ['cameraState', 'visualStats', 'hardwareStats'].map(name => (window as any).__beambench[name]()));
    // Proportional timestamp glyphs change mask width by a pixel; normalize only this permitted text.
    await page.locator('#bb-build').evaluate(node => { node.textContent = 'BUILD_TIMESTAMP'; });
    const screenshot = await page.screenshot({ path: `artifacts/expand-optics-20261024/${label}.png`, animations: 'disabled' });
    await page.close(); return { items, stats, screenshot };
  };
  const baseline = await capture('artifacts/modular-optics-v1/baseline/dist/beambench-standalone.html', 'original');
  const current = await capture(`${fixture}/original-empty/beambench-standalone.html`, 'current');
  expect(current.items).toEqual(baseline.items); expect(current.stats).toEqual(baseline.stats);
  expect(current.screenshot.equals(baseline.screenshot), 'default screenshot must match original, except build stamp').toBe(true);
});

test('ZIP-installed QWP supports real drag, native save/load and undo/redo', async ({ page }) => {
  await open(page, `${fixture}/basic-installed/beambench-standalone.html`);
  await expect(page.locator('.pal-item')).toHaveCount(13);
  const id = 'polarization:quarter-wave';
  const button = page.locator(`[data-type="${id}"]`);
  const start = await button.boundingBox();
  const target = await page.evaluate(() => (window as any).__beambench.screenPointForWorld(-0.1, -0.1));
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up();
  let saved = await save(page);
  const plates = () => saved.elements.filter((e: any) => e.type === 'waveplate');
  expect(plates()).toHaveLength(1);
  expect(plates()[0].props).toMatchObject({ type: 'QWP', delta: Math.PI / 2, axisDeg: 45 });
  await page.keyboard.press('Meta+z'); saved = await save(page); expect(plates()).toHaveLength(0);
  await page.keyboard.press('Meta+Shift+z'); saved = await save(page); expect(plates()).toHaveLength(1);
  await page.goto(pathToFileURL(resolve(`${fixture}/basic-removed/beambench-standalone.html`)).href);
  await page.waitForFunction(() => (window as any).__beambench?.version === 1);
  await expect(page.locator('.pal-item')).toHaveCount(6);
  await page.locator('input[type=file]').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await page.waitForFunction(() => (window as any).__beambench.elementCount() === 4);
  saved = await save(page);
  expect(plates()[0].props).toMatchObject({ type: 'QWP', delta: Math.PI / 2, axisDeg: 45 });
});

test('three libraries show 26/30 entries and new presets survive drag, undo and unloaded-library restore', async ({ page }) => {
  await open(page, `${fixture}/all-original/beambench-standalone.html`);
  await expect(page.locator('.pal-item')).toHaveCount(30);
  await page.goto(pathToFileURL(resolve(`${fixture}/all-basic/beambench-standalone.html`)).href);
  await page.waitForFunction(() => (window as any).__beambench?.version === 1);
  await expect(page.locator('.pal-item')).toHaveCount(26);
  const buttons = await page.locator('.pal-item').all();
  for (const button of buttons) {
    const bounds = await button.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000);
  }
  // Use the existing visualization control to avoid software-rendered marker overhead.
  // The original-UI screenshot test above keeps the default visualization unchanged.
  await page.getByRole('checkbox', { name: '显示偏振', exact: true }).uncheck();
  await page.evaluate(() => (window as any).__beambench.setView('bench'));
  const targets = await page.evaluate(() => {
    const output: { x: number; y: number }[] = [];
    for (let x = -.35; x <= .35; x += .07) for (let z = -.35; z <= -.06; z += .07) {
      const point = (window as any).__beambench.screenPointForWorld(x, z);
      if (document.elementFromPoint(point.x, point.y)?.tagName === 'CANVAS') output.push(point);
    }
    return output;
  });
  const libraries = ['geometric-optics', 'gaussian-beams'].map(id => JSON.parse(readFileSync(`library-packages/${id}/library.json`, 'utf8')));
  const representative = new Set(['geometric-optics:negative-50', 'geometric-optics:biconvex', 'geometric-optics:concave-mirror', 'gaussian-beams:negative-25', 'gaussian-beams:power-meter']);
  const entries = libraries.flatMap(lib => lib.presets.map((preset: any) => ({ ...preset, qualified: `${lib.id}:${preset.id}` })))
    .filter(preset => representative.has(preset.qualified));
  expect(targets.length).toBeGreaterThanOrEqual(entries.length);
  for (const [index, entry] of entries.entries()) {
    const bounds = await page.locator(`[data-type="${entry.qualified}"]`).boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down(); await page.mouse.move(targets[index].x, targets[index].y, { steps: 3 }); await page.mouse.up();
  }
  let saved = await save(page); expect(saved.elements).toHaveLength(7);
  const verify = () => entries.forEach((preset: any, index: number) => {
    expect(saved.elements[index + 2].type).toBe(preset.factory);
    expect(saved.elements[index + 2].props).toMatchObject(preset.params);
  });
  verify();
  await page.keyboard.press('Meta+z'); saved = await save(page); expect(saved.elements).toHaveLength(6);
  await page.keyboard.press('Meta+Shift+z'); saved = await save(page); expect(saved.elements).toHaveLength(7); verify();
  await page.goto(pathToFileURL(resolve(`${fixture}/basic-removed/beambench-standalone.html`)).href);
  await page.waitForFunction(() => (window as any).__beambench?.version === 1);
  await expect(page.locator('.pal-item')).toHaveCount(6);
  await page.locator('input[type=file]').setInputFiles({ name: 'expanded-scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await page.waitForFunction(() => (window as any).__beambench.elementCount() === 8);
  saved = await save(page); verify();
});
