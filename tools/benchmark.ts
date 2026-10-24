#!/usr/bin/env node
/**
 * BB-13 CPU-side benchmark (acceptance-v1 fixture).
 *
 * Measures the deterministic simulation modules that dominate headless cost:
 * trace propagation, BB84 sampling, alignment baselines and command throughput.
 * Browser FPS/GPU timings require a real browser and are reported separately
 * by the E2E environment; this tool never claims to measure them.
 *
 * Usage: npm run test:perf -- --fixture acceptance-v1 --seed 42
 */
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { CommandExecutor } from '../src/domain/commands';
import { computeTrace } from '../src/physics/trace';
import { measure } from '../src/physics/measurement';
import { runBb84 } from '../src/qkd/bb84';
import { parseAlignmentScenario, runAlignmentBaseline } from '../src/alignment/baseline';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const fixture = arg('fixture', 'acceptance-v1');
const seed = Number(arg('seed', '42'));
if (!Number.isInteger(seed)) {
  console.error('seed must be an integer');
  process.exit(1);
}

function bench(name: string, iterations: number, fn: () => void) {
  // Warm up so JIT noise does not dominate the reported number.
  fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = performance.now() - start;
  return {
    name,
    iterations,
    totalMs: Number(totalMs.toFixed(3)),
    opsPerSecond: Number((iterations / (totalMs / 1000)).toFixed(1)),
    meanMs: Number((totalMs / iterations).toFixed(4)),
  };
}

const mount = {
  pivotPoint: [0, 0, 0] as [number, number, number],
  axes: {
    tiltX: { min: -0.1, max: 0.1 },
    tiltY: { min: -0.1, max: 0.1 },
    rotationZ: { min: 0, max: Math.PI },
  },
};

const scene = {
  revision: 1,
  elements: [
    {
      uuid: 'a7f6f0e6-4ba2-4b6b-9f4a-4f0f0b1c2d3e',
      kind: 'source' as const,
      active: true,
      pose: { position: [0, 0.1, 0] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] },
      props: { wavelength_nm: 532, forward_cm: 100, backward_cm: 0, polPreset: 'H', intensity_rel: 1 },
    },
    {
      uuid: 'b7f6f0e6-4ba2-4b6b-9f4a-4f0f0b1c2d3e',
      kind: 'mirror' as const,
      active: true,
      pose: { position: [0, 0.1, 0.1] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] },
      props: { reflectivity: 0.99 },
    },
    {
      uuid: 'c7f6f0e6-4ba2-4b6b-9f4a-4f0f0b1c2d3e',
      kind: 'detector' as const,
      active: true,
      pose: { position: [0, 0.1, 0.3] as [number, number, number], orientation: [0, 0, 0, 1] as [number, number, number, number] },
      props: { apertureRadius_m: 0.01, efficiency: 0.9 },
    },
  ],
};

const trace = computeTrace(scene);
const twoMirror = parseAlignmentScenario(
  JSON.parse(readFileSync(resolve(process.cwd(), 'scenarios/two-mirror.json'), 'utf-8'))
);

const results = [
  bench('trace.computeTrace', 2000, () => {
    computeTrace(scene);
  }),
  bench('measurement.measure', 500, () => {
    measure(trace, scene.elements);
  }),
  bench('qkd.runBb84(10k)', 20, () => {
    runBb84({
      pulses: 10000,
      seed,
      model: {
        transmission: 0.9,
        detectorEfficiency: 0.8,
        darkCountProbability: 0.001,
        misalignmentRad: 0.02,
      },
    });
  }),
  bench('alignment.baseline(20 seeds)', 50, () => {
    runAlignmentBaseline(twoMirror);
  }),
];

const executorBench = await (async () => {
  const executor = new CommandExecutor();
  const start = performance.now();
  const iterations = 200;
  for (let i = 0; i < iterations; i++) {
    await executor.execute({
      protocolVersion: 1,
      requestId: `bench-${i}`,
      expectedRevision: executor.getRevision(),
      method: 'add',
      args: {
        kind: 'iris',
        pose: { position: [0.2, 0, 0], orientation: [0, 0, 0, 1] },
        mount,
        props: { radius_m: 0.005 },
        active: true,
      },
    });
  }
  const totalMs = performance.now() - start;
  return {
    name: 'commands.add',
    iterations,
    totalMs: Number(totalMs.toFixed(3)),
    opsPerSecond: Number((iterations / (totalMs / 1000)).toFixed(1)),
    meanMs: Number((totalMs / iterations).toFixed(4)),
  };
})();
results.push(executorBench);

const report = {
  fixture,
  seed,
  generatedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
  },
  results,
  note: 'CPU-only module timings; browser FPS/GPU are not measured by this tool.',
};

console.log(JSON.stringify(report, null, 2));
