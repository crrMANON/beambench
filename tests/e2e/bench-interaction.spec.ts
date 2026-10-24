/**
 * BB-05 E2E: real mouse drag from the palette onto the bench.
 *
 * Verifies placement goes through the actual HTML5 drag/drop handlers and that
 * the resulting position is snapped to the 25 mm hole grid and inside the table.
 */
import { test, expect, Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

async function benchReady(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => (window as any).__beambench?.version === 1);
}

/** Screen point for a world XZ position, relative to the canvas box. */
async function dropPoint(page: Page, x: number, z: number) {
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const point = await page.evaluate(
    ([wx, wz]) => (window as any).__beambench.screenPointForWorld(wx, wz),
    [x, z]
  );
  const local = { x: Math.round(point.x - box!.x), y: Math.round(point.y - box!.y) };
  const topmost = await page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.tagName ?? null,
    [point.x, point.y]
  );
  expect(topmost).toBe('CANVAS');
  return local;
}

/** Real mouse drag: press the palette item, move onto the bench, release. */
async function dragWithMouse(page: Page, type: string, target: { x: number; y: number }) {
  const item = page.locator(`[data-type="${type}"]`);
  const itemBox = await item.boundingBox();
  const canvasBox = await page.locator('canvas').boundingBox();
  expect(itemBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();

  await page.mouse.move(
    itemBox!.x + itemBox!.width / 2,
    itemBox!.y + itemBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + target.x, canvasBox!.y + target.y, { steps: 12 });
  await page.mouse.up();
}

test.describe('bench interaction', () => {
  test('palette drag supports free placement with optional hole snapping', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);

    const before = await page.evaluate(() => (window as any).__beambench.elementCount());
    const targetPosition = await dropPoint(page, -0.237, -0.213);
    await dragWithMouse(page, 'mirror', targetPosition);
    await page.waitForFunction(
      (expected) => (window as any).__beambench.elementCount() === expected,
      before + 1
    );

    const placement = await page.evaluate(() => (window as any).__beambench.lastPlacement);
    expect(placement.type).toBe('mirror');
    expect(placement.issue).toBeNull();
    expect(placement.snapEnabled).toBe(false);

    const pitch = await page.evaluate(() => (window as any).__beambench.holePitch);
    expect(pitch).toBe(0.025);
    const offGrid = (value: number) =>
      Math.abs(value - Math.round(value / pitch) * pitch);
    // Free placement must not be forced onto the 25 mm hole lattice.
    expect(Math.max(offGrid(placement.position.x), offGrid(placement.position.z)))
      .toBeGreaterThan(1e-6);

    // Optional snapping still works when explicitly enabled.
    await page.evaluate(() => (window as any).__beambench.setSnapToHoles(true));
    const secondTarget = await dropPoint(page, -0.137, -0.113);
    await dragWithMouse(page, 'polarizer', secondTarget);
    await page.waitForFunction(
      (expected) => (window as any).__beambench.elementCount() === expected,
      before + 2
    );
    const snapped = await page.evaluate(() => (window as any).__beambench.lastPlacement);
    expect(snapped.type).toBe('polarizer');
    expect(snapped.snapEnabled).toBe(true);
    expect(offGrid(snapped.position.x)).toBeLessThan(1e-9);
    expect(offGrid(snapped.position.z)).toBeLessThan(1e-9);

    const table = await page.evaluate(() => (window as any).__beambench.table);
    expect(Math.abs(snapped.position.x)).toBeLessThanOrEqual(table.width / 2);
    expect(Math.abs(snapped.position.z)).toBeLessThanOrEqual(table.depth / 2);
    expect(pageErrors).toEqual([]);
  });

  test('three palette drops add exactly three elements', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);

    const beforeState = await page.evaluate(() => ({
      count: (window as any).__beambench.elementCount(),
      ids: (window as any).__beambench.elementPositions().map((p: any) => `${p.type}:${p.id}`),
    }));
    const before = beforeState.count;
    const initialIds = new Set(beforeState.ids);
    const worldTargets: Array<[number, number]> = [
      [-0.25, -0.25],
      [-0.35, -0.3],
      [-0.15, -0.35],
    ];

    for (let i = 0; i < worldTargets.length; i++) {
      const [x, z] = worldTargets[i];
      const targetPosition = await dropPoint(page, x, z);
      await dragWithMouse(page, 'polarizer', targetPosition);
      await page.waitForFunction(
        (expected) => (window as any).__beambench.elementCount() === expected,
        before + i + 1
      );
    }

    const positions = await page.evaluate(() => (window as any).__beambench.elementPositions());
    expect(positions).toHaveLength(before + worldTargets.length);

    const placed = positions.filter((p: any) => !initialIds.has(`${p.type}:${p.id}`));
    expect(placed).toHaveLength(worldTargets.length);
    const table = await page.evaluate(() => (window as any).__beambench.table);
    for (const p of placed) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(table.width / 2);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(table.depth / 2);
    }

    expect(pageErrors).toEqual([]);
  });

  test('real mouse builds a source plus two mirrors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);

    const beforeState = await page.evaluate(() => ({
      count: (window as any).__beambench.elementCount(),
      ids: (window as any).__beambench.elementPositions().map((p: any) => `${p.type}:${p.id}`),
    }));
    const before = beforeState.count;
    const initialIds = new Set(beforeState.ids);
    const builds: Array<{ type: string; world: [number, number] }> = [
      { type: 'source', world: [-0.25, -0.25] },
      { type: 'mirror', world: [-0.35, -0.3] },
      { type: 'mirror', world: [-0.15, -0.35] },
    ];

    for (let i = 0; i < builds.length; i++) {
      const targetPosition = await dropPoint(page, ...builds[i].world);
      await dragWithMouse(page, builds[i].type, targetPosition);
      await page.waitForFunction(
        (expected) => (window as any).__beambench.elementCount() === expected,
        before + i + 1
      );
    }

    const positions = await page.evaluate(() => (window as any).__beambench.elementPositions());
    const placedTypes = positions
      .filter((p: any) => !initialIds.has(`${p.type}:${p.id}`))
      .map((p: any) => p.type)
      .sort();
    expect(placedTypes).toEqual(['mirror', 'mirror', 'source']);
    expect(pageErrors).toEqual([]);
  });

  test('UI menus are localized in Chinese', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await benchReady(page);
    await page.waitForTimeout(400);

    await expect(page.locator('.palette h4')).toHaveText('拖拽器件到光具台');
    await expect(page.locator('[data-type="mirror"]')).toHaveText('反射镜');
    await expect(page.locator('[data-view="top"]')).toHaveText('俯视');
    await expect(page.locator('.views [data-view="bench"]')).toHaveText('全景');
    await expect(page.locator('.lil-gui .title').first()).toHaveText('控制');
    const texts = await page.locator('.lil-gui.root').innerText();
    expect(texts).toContain('显示设置');
    expect(texts).toContain('保存场景');
    expect(texts).not.toContain('视图与变换');
    expect(texts).not.toContain('旋转（绕竖直轴）');
    await expect(page.locator('#reset-camera')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('scene provides a breadboard environment and training view', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/?training=1');
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForFunction(() => (window as any).__beambench?.version === 1);
    await page.waitForTimeout(700);

    const stats = await page.evaluate(() => ({
      environment: (window as any).__beambench.environmentStats(),
      hardware: (window as any).__beambench.hardwareStats(),
      paletteDisplay: getComputedStyle(document.querySelector('.palette')!).display,
      gizmoDisplay: getComputedStyle(document.getElementById('gizmo-controls')!).display,
    }));

    expect(stats.environment.trainingMode).toBe(true);
    expect(stats.environment.table.holes).toBeGreaterThan(1000);
    expect(stats.environment.table.pitch).toBe(0.025);
    expect(stats.environment.contours).toBeGreaterThan(10);
    expect(stats.hardware.mounts).toBeGreaterThanOrEqual(3);
    expect(stats.paletteDisplay).toBe('none');
    expect(stats.gizmoDisplay).toBe('none');

    const capture = await page.evaluate(async () => {
      const frame = await (window as any).__beambench.captureFrame('top');
      const bitmap = await createImageBitmap(frame.blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 4 * 103) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      return { width, height, uniqueColors: colors.size };
    });
    expect(capture.width).toBe(1280);
    expect(capture.height).toBe(720);
    expect(capture.uniqueColors).toBeGreaterThan(3);

    // Training view must always offer an obvious exit path.
    await expect(page.locator('#training-exit')).toBeVisible();
    await page.locator('#training-exit').click();
    await expect(page.locator('.palette')).toBeVisible();
    expect(await page.evaluate(() => document.body.classList.contains('training-mode'))).toBe(false);
    await expect(page.locator('#training-exit')).toBeHidden();

    // H enters, Escape exits.
    await page.keyboard.press('h');
    expect(await page.evaluate(() => document.body.classList.contains('training-mode'))).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.body.classList.contains('training-mode'))).toBe(false);
    expect(pageErrors).toEqual([]);
  });

  test('auto-alignment puts transmissive optics on one line', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => (window as any).__beambench.elementCount());
    const target = await dropPoint(page, -0.25, -0.25);
    await dragWithMouse(page, 'lens', target);
    await page.waitForFunction(
      (expected) => (window as any).__beambench.elementCount() === expected,
      before + 1
    );

    const placed = (await page.evaluate(() => (window as any).__beambench.elementPositions()))
      .filter((item: any) => item.type === 'lens')
      .sort((a: any, b: any) => a.x - b.x)[0];
    expect(placed.x).toBeLessThan(-0.1);

    await expect(page.locator('#auto-align')).toBeVisible();
    const moved = await page.evaluate(() => (window as any).__beambench.autoAlign());
    expect(moved).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(300);

    const aligned = (await page.evaluate(() => (window as any).__beambench.elementPositions()))
      .find((item: any) => item.id === placed.id && item.type === 'lens');
    expect(Math.abs(aligned.x)).toBeLessThan(1e-6);
    expect(Math.abs(aligned.y)).toBeLessThan(1e-6);
    expect(Math.abs(aligned.z - placed.z)).toBeLessThan(0.02);

    const quaternions = await page.evaluate(() => (window as any).__beambench.getScene().elements
      .filter((element: any) => element.kind === 'lens')
      .map((element: any) => element.pose.orientation));
    for (const quaternion of quaternions) {
      expect(Math.abs(quaternion[3])).toBeGreaterThan(0.999);
    }

    expect(pageErrors).toEqual([]);
  });

  test('optics receive Thorlabs-style mount hardware', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => (window as any).__beambench.hardwareStats());
    expect(before.mounts).toBeGreaterThanOrEqual(3);
    expect(before.meshes).toBeGreaterThanOrEqual(30);
    const scales = await page.evaluate(() => (window as any).__beambench.mountInfo()
      .map((item: any) => item.scale));
    for (const scale of scales) {
      expect(scale[0]).toBeCloseTo(3, 6);
      expect(scale[1]).toBeCloseTo(3, 6);
      expect(scale[2]).toBeCloseTo(3, 6);
    }

    const beforeCount = await page.evaluate(() => (window as any).__beambench.elementCount());
    const target = await dropPoint(page, -0.25, -0.25);
    await dragWithMouse(page, 'mirror', target);
    await page.waitForFunction(
      (expected) => (window as any).__beambench.elementCount() === expected,
      beforeCount + 1
    );

    const after = await page.evaluate(() => (window as any).__beambench.hardwareStats());
    expect(after.mounts).toBeGreaterThan(before.mounts);
    expect(after.meshes).toBeGreaterThan(before.meshes);
    expect(pageErrors).toEqual([]);
  });

  test('placed optics and their mounts remain selectable', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForTimeout(500);

    const beforeCount = await page.evaluate(() => (window as any).__beambench.elementCount());
    const target = await dropPoint(page, -0.25, -0.25);
    await dragWithMouse(page, 'mirror', target);
    await page.waitForFunction(
      (expected) => (window as any).__beambench.elementCount() === expected,
      beforeCount + 1
    );

    const positions = await page.evaluate(() => (window as any).__beambench.elementPositions());
    const mirror = (positions as any[]).find(
      (item) => item.type === 'mirror' && item.x < -0.1
    );
    const lens = (positions as any[]).find((item) => item.type === 'lens');

    async function click3D(x: number, y: number, z: number) {
      const point = await page.evaluate(
        ([px, py, pz]) => (window as any).__beambench.screenPoint3D(px, py, pz),
        [x, y, z]
      );
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(180);
      return page.evaluate(() => (window as any).__beambench.selection());
    }

    // Optic body, mount plate and base/post all map back to the mirror.
    expect((await click3D(mirror.x, 0, mirror.z)).label).toBe('mirror');
    expect((await click3D(mirror.x, -0.004, mirror.z)).label).toBe('mirror');
    expect((await click3D(mirror.x, -0.012, mirror.z)).label).toBe('mirror');

    // Original lens mount stays selectable as well.
    expect((await click3D(lens.x, -0.010, lens.z)).label).toBe('lens');

    // Clicking an empty part of the canvas clears the selection.
    await page.mouse.click(850, 300);
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => (window as any).__beambench.selection().size)).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  test('base and head handles use a fixed base with height and yaw controls', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForTimeout(500);

    const lens = (await page.evaluate(() => (window as any).__beambench.mountInfo()))
      .find((item: any) => item.type === 'lens');
    const metrics = await page.evaluate(() => (window as any).__beambench.standMetrics());

    async function click3D(x: number, y: number, z: number) {
      const point = await page.evaluate(
        ([px, py, pz]) => (window as any).__beambench.screenPoint3D(px, py, pz),
        [x, y, z]
      );
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(200);
    }

    // Base: green XY handle and horizontal move only.
    await click3D(lens.base[0] + 0.006, lens.tableTop + 0.0012, lens.base[2]);
    expect(await page.evaluate(() => (window as any).__beambench.selectionRole())).toBe('base');
    const handles = await page.evaluate(() => (window as any).__beambench.selectionHandleInfo());
    expect(handles.map((handle: any) => handle.role)).toEqual(['xy']);

    // Bottom bar: base exposes X/Y numeric inputs, rotate/scale hidden.
    const baseBar = await page.evaluate(() => ({
      bar: getComputedStyle(document.getElementById('gizmo-controls')).display,
      x: document.getElementById('gizmo-pos-x').closest('.gizmo-input-group').style.display !== 'none',
      y: document.getElementById('gizmo-pos-y').closest('.gizmo-input-group').style.display !== 'none',
      z: document.getElementById('gizmo-pos-z').closest('.gizmo-input-group').style.display !== 'none',
      rotate: getComputedStyle(document.getElementById('gizmo-btn-rotate')).display,
      scale: getComputedStyle(document.getElementById('gizmo-btn-scale')).display,
    }));
    expect(baseBar).toMatchObject({ bar: 'flex', x: true, y: true, z: false, rotate: 'none', scale: 'none' });

    const xy = handles[0];
    await page.mouse.move(xy.screen.x, xy.screen.y);
    await page.mouse.down();
    await page.mouse.move(xy.screen.x + 50, xy.screen.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const moved = (await page.evaluate(() => (window as any).__beambench.mountInfo()))
      .find((item: any) => item.type === 'lens');
    expect(Math.abs(moved.head[0] - lens.head[0])).toBeGreaterThan(0.001);
    expect(moved.head[1]).toBeCloseTo(lens.head[1], 6);
    expect(moved.base[0]).toBeCloseTo(moved.head[0], 6);
    expect(moved.base[1]).toBeCloseTo(lens.tableTop, 6);
    expect(await page.evaluate(() => (window as any).__beambench.selectionRole())).toBe('base');

    // Base numeric Y maps to horizontal world Z (bottom bar uses X/Y labels).
    await page.fill('#gizmo-pos-x', '20');
    await page.press('#gizmo-pos-x', 'Enter');
    await page.fill('#gizmo-pos-y', '30');
    await page.press('#gizmo-pos-y', 'Enter');
    await page.waitForTimeout(300);
    const numericBase = (await page.evaluate(() => (window as any).__beambench.mountInfo()))
      .find((item: any) => item.type === 'lens');
    expect(numericBase.head[0]).toBeCloseTo(0.020, 4);
    expect(numericBase.head[2]).toBeCloseTo(0.030, 4);
    expect(numericBase.head[1]).toBeCloseTo(moved.head[1], 6);
    expect(numericBase.base[1]).toBeCloseTo(lens.tableTop, 6);

    // Head: red/blue height arrows, only Z input, rotate available.
    await click3D(numericBase.head[0], numericBase.head[1], numericBase.head[2]);
    const headHandles = await page.evaluate(() => (window as any).__beambench.selectionHandleInfo());
    expect(headHandles.map((handle: any) => handle.role).sort()).toEqual(['yDown', 'yUp']);
    const headBar = await page.evaluate(() => ({
      x: document.getElementById('gizmo-pos-x').closest('.gizmo-input-group').style.display !== 'none',
      y: document.getElementById('gizmo-pos-y').closest('.gizmo-input-group').style.display !== 'none',
      z: document.getElementById('gizmo-pos-z').closest('.gizmo-input-group').style.display !== 'none',
      rotate: getComputedStyle(document.getElementById('gizmo-btn-rotate')).display,
    }));
    expect(headBar).toMatchObject({ x: false, y: false, z: true, rotate: 'block' });

    await page.fill('#gizmo-pos-z', '10');
    await page.press('#gizmo-pos-z', 'Enter');
    await page.waitForTimeout(300);
    const numericHead = (await page.evaluate(() => (window as any).__beambench.mountInfo()))
      .find((item: any) => item.type === 'lens');
    expect(numericHead.head[1]).toBeCloseTo(0.010, 4);
    expect(numericHead.base[0]).toBeCloseTo(numericBase.base[0], 6);
    expect(numericHead.base[1]).toBeCloseTo(numericBase.base[1], 6);
    expect(numericHead.base[2]).toBeCloseTo(numericBase.base[2], 6);

    // Rotate mode shows ring gizmos and hides custom handles.
    await page.click('#gizmo-btn-rotate');
    await page.waitForTimeout(300);
    const rotateState = await page.evaluate(() => ({
      gizmo: (window as any).__beambench.gizmoState(),
      handles: (window as any).__beambench.selectionHandleInfo().length,
    }));
    expect(rotateState.gizmo.mode).toBe('rotate');
    expect(rotateState.gizmo.yaw).toBe(true);
    expect(rotateState.gizmo.tilt).toBe(true);
    expect(rotateState.gizmo.main).toBe(false);
    expect(rotateState.handles).toBe(0);
    await page.click('#gizmo-btn-translate');
    await page.waitForTimeout(250);
    expect((await page.evaluate(() => (window as any).__beambench.selectionHandleInfo()))
      .map((handle: any) => handle.role).sort()).toEqual(['yDown', 'yUp']);

    const up = (await page.evaluate(() => (window as any).__beambench.selectionHandleInfo()))
      .find((handle: any) => handle.role === 'yUp');
    await page.mouse.move(up.screen.x, up.screen.y);
    await page.mouse.down();
    await page.mouse.move(up.screen.x, up.screen.y - 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const raised = (await page.evaluate(() => (window as any).__beambench.mountInfo()))
      .find((item: any) => item.type === 'lens');
    expect(raised.head[1]).toBeGreaterThan(numericHead.head[1] + 0.002);
    expect(raised.base[0]).toBeCloseTo(numericHead.base[0], 6);
    expect(raised.base[1]).toBeCloseTo(numericHead.base[1], 6);
    expect(raised.base[2]).toBeCloseTo(numericHead.base[2], 6);
    expect(raised.postHeight).toBeGreaterThan(numericHead.postHeight);

    // Bottom-bar rotate mode + yaw input; base stays put.
    await page.click('#gizmo-btn-rotate');
    await page.waitForTimeout(200);
    await page.fill('#gizmo-rot-yaw', '15');
    await page.press('#gizmo-rot-yaw', 'Enter');
    await page.waitForTimeout(300);
    const rotated = (await page.evaluate(() => (window as any).__beambench.mountInfo()))
      .find((item: any) => item.type === 'lens');
    expect(Math.abs(rotated.quaternion[1])).toBeGreaterThan(0.05);
    expect(rotated.base[0]).toBeCloseTo(raised.base[0], 6);
    expect(rotated.base[2]).toBeCloseTo(raised.base[2], 6);

    // No floating heads: post top equals the optical head bottom.
    const mounts = await page.evaluate(() => (window as any).__beambench.mountInfo());
    for (const mount of mounts) {
      const postTop = mount.base[1] + metrics.collarTop + mount.postHeight;
      expect(Math.abs(postTop - mount.headBottom)).toBeLessThan(1e-4);
    }
    expect(pageErrors).toEqual([]);
  });

  test('selecting a source repeatedly keeps one output panel', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForTimeout(500);

    const source = (await page.evaluate(() => (window as any).__beambench.mountInfo()))
      .find((item: any) => item.type === 'source');
    // Click the source base edge (the lens now sits between camera and head).
    const point = await page.evaluate(
      ([x, y, z]) => (window as any).__beambench.screenPoint3D(x, y, z),
      [source.base[0] + 0.012, source.tableTop + 0.0012, source.base[2]]
    );

    const countOutputPanels = () => page.evaluate(() =>
      [...document.querySelectorAll('.lil-gui.root > .children > .lil-gui > .title')]
        .filter((title) => title.textContent === '输出光束参数').length
    );

    for (let i = 0; i < 4; i++) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(350);
      expect(await countOutputPanels()).toBe(1);
    }

    const lens = (await page.evaluate(() => (window as any).__beambench.mountInfo()))
      .find((item: any) => item.type === 'lens');
    const lensPoint = await page.evaluate(
      ([x, y, z]) => (window as any).__beambench.screenPoint3D(x, y, z),
      [lens.head[0], lens.head[1], lens.head[2]]
    );
    await page.mouse.click(lensPoint.x, lensPoint.y);
    await page.waitForTimeout(350);
    expect(await countOutputPanels()).toBe(1);

    await page.mouse.click(850, 300);
    await page.waitForTimeout(350);
    expect(await countOutputPanels()).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  test('optics use glass/mirror materials inside open mounts', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForTimeout(600);

    const visual = await page.evaluate(() => (window as any).__beambench.visualStats());
    expect(visual.environment).toBe(true);
    expect(visual.apertureMounts).toBeGreaterThanOrEqual(2);
    expect(visual.glassMaterials).toBeGreaterThan(0);
    expect(visual.mirrorMaterials).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('side and top views are level, framed and share the same direction', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForTimeout(400);

    const snapshot = () => page.evaluate(() => {
      const bench = (window as any).__beambench;
      const table = bench.environmentStats().table;
      return {
        camera: bench.cameraState(),
        tableY: table.topY,
        points: bench.mountInfo().map((mount: any) => {
          const screen = bench.screenPoint3D(mount.head[0], mount.head[1], mount.head[2]);
          return { type: mount.type, x: screen.x, y: screen.y };
        }),
      };
    });

    await page.locator('[data-view="side"]').click();
    await page.waitForTimeout(300);
    const side = await snapshot();

    // Perfectly horizontal camera: the table projects to one line.
    expect(side.camera.position[1]).toBeCloseTo(side.tableY, 6);
    expect(side.camera.target[1]).toBeCloseTo(side.tableY, 6);
    expect(side.camera.up[1]).toBeCloseTo(1, 6);
    const tableLine = await page.evaluate(() => {
      const bench = (window as any).__beambench;
      const y = bench.environmentStats().table.topY;
      return [-0.5, 0, 0.5].map((z) => bench.screenPoint3D(0, y, z).y);
    });
    expect(Math.max(...tableLine) - Math.min(...tableLine)).toBeLessThan(1);

    const xs = side.points.map((point: any) => point.x);
    const ys = side.points.map((point: any) => point.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1280);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(720);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1280 * 0.35);

    await page.locator('[data-view="top"]').click();
    await page.waitForTimeout(300);
    const top = await snapshot();

    // Top view = side view rotated 90° around the horizontal axis: same
    // left/right ordering of the bench, camera up = -X.
    expect(top.camera.position[1]).toBeGreaterThan(top.tableY + 0.02);
    expect(top.camera.up[0]).toBeCloseTo(-1, 6);
    expect(top.camera.up[1]).toBeCloseTo(0, 6);
    const order = (points: any[]) =>
      [...points].sort((a, b) => a.x - b.x).map((point) => point.type);
    expect(order(top.points)).toEqual(order(side.points));
    for (const point of top.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1280);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(720);
    }

    await page.locator('[data-view="perspective"]').click();
    const perspective = await page.evaluate(() => (window as any).__beambench.cameraPosition());
    expect(perspective[0]).toBeCloseTo(0.06, 6);
    expect(perspective[2]).toBeCloseTo(0.08, 6);

    await page.locator('[data-view="side"]').click();
    await page.locator('#reset-camera').click();
    const reset = await page.evaluate(() => (window as any).__beambench.cameraPosition());
    expect(reset[0]).toBeCloseTo(0.06, 6);
    expect(reset[2]).toBeCloseTo(0.08, 6);

    expect(pageErrors).toEqual([]);
  });

  test('host bridge serves revision-matched state, observation and capture', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForFunction(() => (window as any).__beambench.revision > 0);
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const channel = new MessageChannel();

      const ready = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('handshake timeout')), 5000);
        channel.port1.onmessage = (event) => {
          if (event.data?.type === 'beambench:ready') {
            clearTimeout(timer);
            resolve(event.data);
          }
        };
        channel.port1.start?.();
        window.postMessage(
          { type: 'beambench:hello', protocolVersion: 1 },
          location.origin,
          [channel.port2]
        );
      });

      const pending = new Map<string, (value: any) => void>();
      channel.port1.addEventListener('message', (event) => {
        const resolve = pending.get(event.data?.requestId);
        if (resolve) {
          pending.delete(event.data.requestId);
          resolve(event.data);
        }
      });
      const request = (method: string, args: unknown, expectedRevision: number) =>
        new Promise<any>((resolve) => {
          const id = crypto.randomUUID();
          pending.set(id, resolve);
          channel.port1.postMessage({
            protocolVersion: 1,
            requestId: id,
            expectedRevision,
            method,
            args,
          });
        });

      const state = await request('get_state', null, ready.revision);
      const observation = await request('observe', null, state.revision);
      const capture = await request('capture', { view: 'top' }, state.revision);
      const stale = await request('get_state', null, state.revision - 1);
      const save = await request('save_scene', null, state.revision);
      const bb84 = await request('run_bb84', { pulses: 2000, seed: 11 }, state.revision);
      const unsupported = await request('setDof', {
        uuid: 'missing',
        axis: 'tiltX',
        value: [0, 0],
      }, state.revision);

      let image = { decoded: false, width: 0, height: 0, uniqueColors: 0 };
      if (capture.ok && capture.result?.blob) {
        const bitmap = await createImageBitmap(capture.result.blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (context) {
          context.drawImage(bitmap, 0, 0);
          const data = context.getImageData(
            0, 0, bitmap.width, bitmap.height
          ).data;
          const colors = new Set<string>();
          for (let i = 0; i < data.length; i += 4 * 97) {
            colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          }
          image = {
            decoded: true,
            width: bitmap.width,
            height: bitmap.height,
            uniqueColors: colors.size,
          };
        }
        bitmap.close();
      }

      return {
        ready,
        state: {
          ok: state.ok,
          revision: state.revision,
          elements: state.result?.elements?.length,
        },
        observation: {
          ok: observation.ok,
          revision: observation.revision,
          detectorCount: observation.result?.detectors?.length,
          traceStatus: observation.result?.traceStatus,
        },
        capture: {
          ok: capture.ok,
          revision: capture.revision,
          view: capture.result?.view,
          bytes: capture.result?.bytes,
          blobSize: capture.result?.blob?.size,
          blobType: capture.result?.blob?.type,
          image,
        },
        stale: { ok: stale.ok, error: stale.error },
        save: {
          ok: save.ok,
          bytes: save.result?.bytes,
          version: (() => {
            try { return JSON.parse(save.result.json).version; } catch { return null; }
          })(),
        },
        bb84: {
          ok: bb84.ok,
          revision: bb84.revision,
          pulses: bb84.result?.pulses,
          engineCommit: bb84.result?.engineCommit,
          qber: bb84.result?.sifted?.qber,
          sceneRevision: bb84.result?.sceneRevision,
        },
        unsupported: { ok: unsupported.ok, error: unsupported.error },
      };
    });

    expect(result.ready.revision).toBeGreaterThan(0);
    expect(result.state.ok).toBe(true);
    expect(result.state.elements).toBeGreaterThanOrEqual(3);
    expect(result.observation.ok).toBe(true);
    expect(result.observation.revision).toBe(result.state.revision);
    expect(result.observation.traceStatus).toBe('OK');

    expect(result.capture.ok).toBe(true);
    expect(result.capture.revision).toBe(result.state.revision);
    expect(result.capture.view).toBe('top');
    expect(result.capture.blobType).toBe('image/png');
    expect(result.capture.blobSize).toBeGreaterThan(0);
    expect(result.capture.image.decoded).toBe(true);
    expect(result.capture.image.width).toBe(1280);
    expect(result.capture.image.height).toBe(720);
    expect(result.capture.image.uniqueColors).toBeGreaterThan(1);

    expect(result.stale.error).toBe('STALE_REVISION');
    expect(result.save.ok).toBe(true);
    expect(result.save.version).toBe(1);
    expect(result.bb84.ok).toBe(true);
    expect(result.bb84.pulses).toBe(2000);
    expect(result.bb84.engineCommit).toBe('bb84-v1');
    expect(result.bb84.qber).toBeGreaterThan(0);
    expect(result.bb84.qber).toBeLessThan(1);
    expect(result.bb84.sceneRevision).toBe(result.state.revision);
    expect(result.unsupported.error).toBe('VALIDATION');
    expect(pageErrors).toEqual([]);
  });

  test('host bridge mutates the live scene', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForFunction(() => (window as any).__beambench.revision > 0);
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const channel = new MessageChannel();
      const ready = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('handshake timeout')), 5000);
        channel.port1.onmessage = (event) => {
          if (event.data?.type === 'beambench:ready') {
            clearTimeout(timer);
            resolve(event.data);
          }
        };
        channel.port1.start?.();
        window.postMessage(
          { type: 'beambench:hello', protocolVersion: 1 },
          location.origin,
          [channel.port2]
        );
      });

      const pending = new Map<string, (value: any) => void>();
      channel.port1.addEventListener('message', (event) => {
        const resolve = pending.get(event.data?.requestId);
        if (resolve) {
          pending.delete(event.data.requestId);
          resolve(event.data);
        }
      });
      const request = (method: string, args: unknown, expectedRevision: number) =>
        new Promise<any>((resolve) => {
          const id = crypto.randomUUID();
          pending.set(id, resolve);
          channel.port1.postMessage({
            protocolVersion: 1,
            requestId: id,
            expectedRevision,
            method,
            args,
          });
        });

      const beforeCount = (window as any).__beambench.elementCount();
      const initial = await request('get_state', null, ready.revision);

      const added = await request('add', {
        kind: 'mirror',
        pose: { position: [0.3, 0, 0.2], orientation: [0, 0, 0, 1] },
        props: { reflectivity: 0.99 },
      }, initial.revision);
      const uuid = added.result?.uuid;
      const afterAdd = await request('get_state', null, added.revision);
      const addCount = (window as any).__beambench.elementCount();

      const undo = await request('undo', null, added.revision);
      const afterUndo = await request('get_state', null, undo.revision);
      const redo = await request('redo', null, undo.revision);
      const afterRedo = await request('get_state', null, redo.revision);

      const posed = await request('setPose', {
        uuid,
        pose: { position: [0.32, 0, 0.22], orientation: [0, 0, 0, 1] },
      }, redo.revision);
      const tuned = await request('setParam', {
        uuid,
        param: 'reflectivity',
        value: 0.9,
      }, posed.revision);
      const afterWrite = await request('get_state', null, tuned.revision);
      const element = afterWrite.result?.elements?.find((item: any) => item.uuid === uuid);

      const removed = await request('remove', { uuid }, tuned.revision);
      const afterRemove = await request('get_state', null, removed.revision);
      const removeCount = (window as any).__beambench.elementCount();

      const sourceAdd = await request('add', {
        kind: 'source',
        pose: { position: [0.4, 0, 0.4], orientation: [0, 0, 0, 1] },
        props: {
          wavelength_nm: 532,
          forward_cm: 20,
          backward_cm: 0,
          polPreset: 'H',
        },
      }, removed.revision);
      const detectorAdd = await request('add', {
        kind: 'detector',
        pose: { position: [0.4, 0, 0.5], orientation: [0, 0, 0, 1] },
        props: { apertureRadius_m: 0.01, efficiency: 1 },
      }, sourceAdd.revision);
      const observed = await request('observe', null, detectorAdd.revision);
      const reading = observed.result?.detectors?.find(
        (entry: any) => entry.uuid === detectorAdd.result?.uuid
      );
      const removeDetector = await request('remove', {
        uuid: detectorAdd.result?.uuid,
      }, detectorAdd.revision);
      const removeSource = await request('remove', {
        uuid: sourceAdd.result?.uuid,
      }, removeDetector.revision);
      const afterCleanup = await request('get_state', null, removeSource.revision);

      const firstUuid = initial.result?.elements?.[0]?.uuid;
      const dof = await request('setDof', {
        uuid: firstUuid,
        axis: 'tiltY',
        value: [-0.03, 0.03],
      }, removeSource.revision);
      const afterDof = await request('get_state', null, dof.revision);
      const dofLimits = afterDof.result?.elements?.find(
        (entry: any) => entry.uuid === firstUuid
      )?.mount?.axes?.tiltY;

      const savedScene = await request('save_scene', null, dof.revision);
      const reset = await request('reset', { seed: 99 }, savedScene.revision);
      const afterReset = await request('get_state', null, reset.revision);

      const loaded = await request('load_scene', {
        json: savedScene.result?.json,
      }, reset.revision);
      const afterLoad = await request('get_state', null, loaded.revision);
      const loadCount = (window as any).__beambench.elementCount();

      return {
        beforeCount,
        initialCount: initial.result?.elements?.length,
        added: {
          ok: added.ok,
          revision: added.revision,
          uuid,
          revisionAdvanced: added.revision === initial.revision + 1,
        },
        afterAddCount: afterAdd.result?.elements?.length,
        addCount,
        undo: {
          ok: undo.ok,
          count: afterUndo.result?.elements?.length,
          hasUuid: afterUndo.result?.elements?.some((item: any) => item.uuid === uuid),
        },
        redo: {
          ok: redo.ok,
          count: afterRedo.result?.elements?.length,
          hasUuid: afterRedo.result?.elements?.some((item: any) => item.uuid === uuid),
        },
        posed: posed.ok,
        tuned: tuned.ok,
        elementPose: element?.pose?.position,
        reflectivity: element?.props?.reflectivity,
        removed: removed.ok,
        finalCount: afterRemove.result?.elements?.length,
        removeCount,
        writeExtras: {
          dof: dof.ok,
          dofLimits,
          reset: reset.ok,
          resetError: afterReset.error ?? null,
          resetRevision: reset.revision ?? null,
          liveRevision: (window as any).__beambench.revision,
          resetCount: afterReset.result?.elements?.length,
          resetSeed: afterReset.result?.seed,
          load: loaded.ok,
          loadCount: afterLoad.result?.elements?.length,
          loadHasFirstUuid: afterLoad.result?.elements?.some(
            (entry: any) => entry.uuid === firstUuid
          ),
          uiCount: loadCount,
        },
        detector: {
          added: sourceAdd.ok && detectorAdd.ok,
          observeOk: observed.ok,
          revision: observed.revision,
          found: !!reading,
          hit: reading?.hit ?? null,
          incidentPower: reading?.incidentPower ?? null,
          receivedRatio: reading?.receivedRatio ?? null,
          cleanup: removeDetector.ok && removeSource.ok,
          finalCount: afterCleanup.result?.elements?.length,
        },
      };
    });

    expect(result.added.ok).toBe(true);
    expect(result.added.uuid).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.added.revisionAdvanced).toBe(true);
    expect(result.afterAddCount).toBe(result.initialCount + 1);
    expect(result.addCount).toBe(result.beforeCount + 1);
    expect(result.undo.ok).toBe(true);
    expect(result.undo.count).toBe(result.initialCount);
    expect(result.undo.hasUuid).toBe(false);
    expect(result.redo.ok).toBe(true);
    expect(result.redo.count).toBe(result.initialCount + 1);
    expect(result.redo.hasUuid).toBe(true);
    expect(result.posed).toBe(true);
    expect(result.tuned).toBe(true);
    expect(result.elementPose).toEqual([0.32, 0, 0.22]);
    expect(result.reflectivity).toBe(0.9);
    expect(result.removed).toBe(true);
    expect(result.finalCount).toBe(result.initialCount);
    expect(result.removeCount).toBe(result.beforeCount);
    expect(result.detector.added).toBe(true);
    expect(result.detector.observeOk).toBe(true);
    expect(result.detector.found).toBe(true);
    expect(result.detector.hit).toBe(true);
    expect(result.detector.incidentPower).toBeGreaterThan(0);
    expect(result.detector.receivedRatio).toBeGreaterThan(0.9);
    expect(result.detector.cleanup).toBe(true);
    expect(result.detector.finalCount).toBe(result.initialCount);
    expect(result.writeExtras.dof).toBe(true);
    expect(result.writeExtras.dofLimits).toEqual({ min: -0.03, max: 0.03 });
    expect(result.writeExtras.reset).toBe(true);
    expect(result.writeExtras.resetError).toBeNull();
    expect(result.writeExtras.resetCount).toBe(0);
    expect(result.writeExtras.resetSeed).toBe(99);
    expect(result.writeExtras.load).toBe(true);
    expect(result.writeExtras.loadCount).toBe(result.initialCount);
    expect(result.writeExtras.loadHasFirstUuid).toBe(true);
    expect(result.writeExtras.uiCount).toBe(result.initialCount);
    expect(pageErrors).toEqual([]);
  });

  test('agent runner replays a scripted policy over the host bridge', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await benchReady(page);
    await page.waitForFunction(() => (window as any).__beambench.revision > 0);
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const channel = new MessageChannel();
      const ready = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('handshake timeout')), 5000);
        channel.port1.onmessage = (event) => {
          if (event.data?.type === 'beambench:ready') {
            clearTimeout(timer);
            resolve(event.data);
          }
        };
        channel.port1.start?.();
        window.postMessage(
          { type: 'beambench:hello', protocolVersion: 1 },
          location.origin,
          [channel.port2]
        );
      });

      const pending = new Map<string, (value: any) => void>();
      channel.port1.addEventListener('message', (event) => {
        const resolve = pending.get(event.data?.requestId);
        if (resolve) {
          pending.delete(event.data.requestId);
          resolve(event.data);
        }
      });

      let revision = ready.revision;
      const client = {
        async request(method: string, args: unknown, options: { expectedRevision?: number } = {}) {
          const expectedRevision = options.expectedRevision ?? revision;
          const response = await new Promise<any>((resolve) => {
            const id = crypto.randomUUID();
            pending.set(id, resolve);
            channel.port1.postMessage({
              protocolVersion: 1,
              requestId: id,
              expectedRevision,
              method,
              args,
            });
          });
          if (typeof response.revision === 'number') revision = response.revision;
          return response;
        },
      };

      const { HostAgentEnvironment } = await import('/src/agent/host-environment.ts');
      const { runAgent } = await import('/src/agent/runner.ts');

      const environment = new HostAgentEnvironment({
        client,
        initialRevision: ready.revision,
        score: (observation: any) => observation.detectors?.length ?? 0,
      });

      let step = 0;
      const policy = () => {
        step++;
        if (step === 1) {
          return {
            type: 'command',
            method: 'add',
            args: {
              kind: 'mirror',
              pose: { position: [0.25, 0, 0.25], orientation: [0, 0, 0, 1] },
              props: { reflectivity: 0.95 },
            },
          };
        }
        if (step === 2) return { type: 'capture', view: 'perspective' };
        return { type: 'stop', reason: 'replay complete' };
      };

      const countBefore = (window as any).__beambench.elementCount();
      const record = await runAgent(environment, policy, {
        runId: 'e2e-replay',
        policyName: 'scripted-e2e',
        budget: {
          maxSteps: 5,
          maxNoImprovement: 5,
          maxCaptures: 2,
          successThreshold: 1,
          improvementEpsilon: 1e-9,
        },
      });
      const countAfter = (window as any).__beambench.elementCount();

      return {
        status: record.status,
        terminationReason: record.terminationReason,
        steps: record.steps.map((entry: any) => ({
          type: entry.action.type,
          ok: entry.response?.ok ?? null,
          frame: entry.frame ?? null,
          rejected: entry.rejected ?? null,
        })),
        countBefore,
        countAfter,
        serialized: JSON.stringify(record),
      };
    });

    expect(result.status).toBe('STOPPED');
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]).toMatchObject({ type: 'command', ok: true });
    expect(result.steps[1].type).toBe('capture');
    expect(result.steps[1].frame).toBeTruthy();
    expect(result.steps[1].frame.revision).toBeGreaterThan(0);
    expect(result.steps[2].type).toBe('stop');
    expect(result.countAfter).toBe(result.countBefore + 1);
    expect(result.serialized).not.toMatch(/token|api[_-]?key|prompt/i);
    expect(pageErrors).toEqual([]);
  });
});
