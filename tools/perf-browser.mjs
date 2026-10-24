#!/usr/bin/env node
/**
 * BB-13 browser performance harness (AC09).
 *
 * Measures, on a fixed viewport (1280x720, DPR 2) with 30 devices:
 * - median FPS over a 30 s window after a 5 s warm-up
 * - nearest-rank P95 latency of 200 valid operation+observation round-trips
 * - JS heap growth and renderer object counts after 100 reloads
 *
 * The environment is reported explicitly. If the browser falls back to a
 * software renderer the status is BLOCKED_ENV instead of claiming a pass.
 *
 * Usage: node tools/perf-browser.mjs [--reloads 100] [--fps-seconds 30]
 *                                    [--operations 200] [--devices 30]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? Number(process.argv[index + 1]) : fallback;
}

const RELOADS = arg('reloads', 100);
const FPS_SECONDS = arg('fps-seconds', 30);
const OPERATIONS = arg('operations', 200);
const DEVICES = arg('devices', 30);
const BASE_URL = 'http://localhost:5173/beambench.html';

async function serverReady() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await serverReady()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let server = null;
if (!(await serverReady())) {
  server = spawn('npm', ['run', 'dev'], { cwd: process.cwd(), stdio: 'ignore' });
  if (!(await waitForServer())) {
    console.error('Dev server did not start');
    process.exit(1);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

async function loadApp() {
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__beambench?.version === 1);
  await page.waitForFunction(() => window.__beambench.revision > 0);
}

await loadApp();

const environment = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent,
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'unknown',
    devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
  };
});

// Connect through the real host bridge and keep revision in sync.
const bridge = await page.evaluate(async () => {
  const channel = new MessageChannel();
  const ready = await new Promise((resolve, reject) => {
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

  const pending = new Map();
  channel.port1.addEventListener('message', (event) => {
    const resolve = pending.get(event.data?.requestId);
    if (resolve) {
      pending.delete(event.data.requestId);
      resolve(event.data);
    }
  });

  const state = { revision: ready.revision };
  window.__perf = {
    get revision() {
      return state.revision;
    },
    request(method, args) {
      return new Promise((resolve) => {
        const id = crypto.randomUUID();
        pending.set(id, (response) => {
          if (typeof response.revision === 'number') state.revision = response.revision;
          resolve(response);
        });
        channel.port1.postMessage({
          protocolVersion: 1,
          requestId: id,
          expectedRevision: state.revision,
          method,
          args,
        });
      });
    },
  };
  return { revision: ready.revision };
});

// Fill the bench to the accepted device count using real host commands.
const load = await page.evaluate(async (target) => {
  const before = window.__beambench.elementCount();
  const added = [];
  for (let i = before; i < target; i++) {
    const response = await window.__perf.request('add', {
      kind: 'mirror',
      pose: {
        position: [-0.5 + (i % 6) * 0.2, 0, -0.4 + Math.floor(i / 6) * 0.15],
        orientation: [0, 0, 0, 1],
      },
      props: { reflectivity: 0.99 },
    });
    added.push({ ok: response.ok, error: response.error, uuid: response.result?.uuid });
  }
  return { before, after: window.__beambench.elementCount(), added };
}, DEVICES);

const state = await page.evaluate(() => {
  const result = window.__beambench.getScene();
  const mirror = result?.elements?.find((element) => element.kind === 'mirror');
  return { count: result?.elements?.length ?? 0, uuid: mirror?.uuid ?? null };
});

await page.waitForTimeout(5000); // warm-up

const fps = await page.evaluate(async (durationMs) => {
  const deltas = [];
  let last = performance.now();
  const start = last;
  await new Promise((resolve) => {
    function tick(now) {
      deltas.push(now - last);
      last = now;
      if (now - start < durationMs) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
  const elapsed = performance.now() - start;
  deltas.sort((a, b) => a - b);
  const pick = (fraction) => deltas[Math.min(deltas.length - 1, Math.ceil(deltas.length * fraction) - 1)];
  return {
    frames: deltas.length,
    elapsedMs: elapsed,
    medianFps: 1000 / pick(0.5),
    meanFps: deltas.length / (elapsed / 1000),
    p95FrameMs: pick(0.95),
  };
}, FPS_SECONDS * 1000);

const latency = await page.evaluate(async ({ operations, uuid }) => {
  if (!uuid) return { samples: [], errors: ['no mirror uuid'] };
  const samples = [];
  const errors = [];
  for (let i = 0; i < operations; i++) {
    const start = performance.now();
    const pose = {
      position: [0.25, (i % 2) * 0.002, 0.25],
      orientation: [0, 0, 0, 1],
    };
    const moved = await window.__perf.request('setPose', { uuid, pose });
    if (!moved.ok) {
      errors.push(moved.error);
      continue;
    }
    const observed = await window.__perf.request('observe', null);
    if (!observed.ok) {
      errors.push(observed.error);
      continue;
    }
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples.length
    ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]
    : null;
  return {
    samples: samples.length,
    errors: errors.length,
    firstError: errors[0] ?? null,
    p50Ms: samples.length ? samples[Math.floor(samples.length / 2)] : null,
    p95Ms: p95,
    maxMs: samples.length ? samples[samples.length - 1] : null,
  };
}, { operations: OPERATIONS, uuid: state.uuid });

// Reload loop: heap growth and renderer object counts.
const samples = [];
for (let i = 0; i < RELOADS; i++) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__beambench?.version === 1);
  await page.waitForTimeout(250);
  if (i >= 4 && (i === 4 || (i + 1) % 10 === 0)) {
    samples.push(await page.evaluate(() => ({
      reload: 0,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
      ...window.__beambench.rendererInfo(),
    })));
    samples[samples.length - 1].reload = i + 1;
  }
}

const heapSamples = samples.filter((sample) => sample.heapBytes !== null);
const heapBaseline = heapSamples[0]?.heapBytes ?? null;
const heapFinal = heapSamples.at(-1)?.heapBytes ?? null;
const heapDelta = heapBaseline !== null && heapFinal !== null ? heapFinal - heapBaseline : null;
const geometrySamples = samples.map((sample) => sample.geometries);
const textureSamples = samples.map((sample) => sample.textures);
const monotonic = (values) => values.length > 1 &&
  values.every((value, index) => index === 0 || value >= values[index - 1]);
const software = /swiftshader|llvmpipe|software|basic render/i.test(environment.renderer);

const criteria = {
  fpsPass: fps.medianFps >= 30,
  latencyPass: latency.p95Ms !== null && latency.p95Ms <= 200,
  memoryPass: heapDelta !== null
    ? heapDelta <= 50 * 1024 * 1024 && !(monotonic(geometrySamples) && monotonic(textureSamples))
    : false,
};

const status = software
  ? 'BLOCKED_ENV'
  : Object.values(criteria).every(Boolean) ? 'PASS' : 'FAIL';

const report = {
  generatedAt: new Date().toISOString(),
  status,
  environment: {
    ...environment,
    node: process.version,
    playwright: (await import('playwright/package.json', { with: { type: 'json' } })).default.version,
  },
  load: { requested: DEVICES, ...load, sceneCount: state.count },
  fps: { windowSeconds: FPS_SECONDS, ...fps },
  latency: { requested: OPERATIONS, ...latency },
  memory: {
    reloads: RELOADS,
    samples,
    heapBaselineBytes: heapBaseline,
    heapFinalBytes: heapFinal,
    heapDeltaBytes: heapDelta,
    geometrySamples,
    textureSamples,
    monotonicGeometry: monotonic(geometrySamples),
    monotonicTextures: monotonic(textureSamples),
  },
  criteria,
  pageErrors,
  note: software
    ? 'Software WebGL renderer detected; AC09 thresholds are reported as BLOCKED_ENV, not as a pass.'
    : 'Measured in the launched Chromium build at the reported viewport.',
};

console.log(JSON.stringify(report, null, 2));
writeFileSync(resolve(process.cwd(), 'docs/PERF_BROWSER.json'), JSON.stringify(report, null, 2));

await browser.close();
server?.kill('SIGTERM');
process.exit(pageErrors.length > 0 ? 1 : 0);
