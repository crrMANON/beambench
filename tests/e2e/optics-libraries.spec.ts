import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const fixture = 'artifacts/modular-optics-v1/build-fixture';
async function open(page: Page, path: string) {
  // Fixed clock makes the animated polarization markers comparable across pages.
  await page.clock.install({ time: new Date('2026-10-18T00:00:00Z') });
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
  const baseline = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const current = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await open(baseline, 'artifacts/modular-optics-v1/baseline/dist/beambench-standalone.html');
  await open(current, `${fixture}/original-empty/beambench-standalone.html`);
  expect(await current.locator('.pal-item').allTextContents()).toEqual(await baseline.locator('.pal-item').allTextContents());
  for (const method of ['cameraState', 'visualStats', 'hardwareStats']) {
    expect(await current.evaluate((name) => (window as any).__beambench[name](), method))
      .toEqual(await baseline.evaluate((name) => (window as any).__beambench[name](), method));
  }
  const a = await baseline.screenshot({ mask: [baseline.locator('#bb-build')], animations: 'disabled' });
  const b = await current.screenshot({ mask: [current.locator('#bb-build')], animations: 'disabled' });
  expect(b.equals(a), 'default screenshot must match original, except build stamp').toBe(true);
  await baseline.close(); await current.close();
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
  await page.clock.runFor(100);
  await page.keyboard.press('Meta+Shift+z'); saved = await save(page); expect(plates()).toHaveLength(1);
  await page.goto(pathToFileURL(resolve(`${fixture}/basic-removed/beambench-standalone.html`)).href);
  await page.waitForFunction(() => (window as any).__beambench?.version === 1);
  await expect(page.locator('.pal-item')).toHaveCount(6);
  await page.locator('input[type=file]').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await page.clock.runFor(100);
  saved = await save(page);
  expect(plates()[0].props).toMatchObject({ type: 'QWP', delta: Math.PI / 2, axisDeg: 45 });
});
