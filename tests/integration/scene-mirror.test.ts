/**
 * Integration tests for the live-scene snapshot mapping and read-only mirror.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createEmptyScene } from '../../src/domain/scene-io';
import { validateScene } from '../../src/domain/scene-validation';
import {
  mapElementKind,
  mapElementProps,
  sceneFromUpstream,
} from '../../src/integration/upstream-scene';
import { SceneMirror } from '../../src/integration/scene-mirror';
import { CaptureError, CaptureResult, CaptureView } from '../../src/render/capture';
import type { CommandRequest } from '../../src/domain/commands';

const pose = (x = 0, y = 0, z = 0, q: [number, number, number, number] = [0, 0, 0, 1]) => ({
  position: { x, y, z },
  quaternion: { x: q[0], y: q[1], z: q[2], w: q[3] },
});

function mirrorRequest(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    protocolVersion: 1,
    requestId: 'req-1',
    expectedRevision: 0,
    method: 'get_state',
    args: null,
    ...overrides,
  };
}

describe('Upstream type mapping', () => {
  it('maps interactive element types', () => {
    expect(mapElementKind('beamSplitter')).toBe('bs');
    expect(mapElementKind('beamBlock')).toBe('beamDump');
    expect(mapElementKind('multimeter')).toBe('detector');
    expect(mapElementKind('ruler')).toBeNull();
  });

  it('satisfies the domain validator with upstream prop names', () => {
    expect(mapElementProps('lens', { f: 0.05 }).focalLength_m).toBe(0.05);
    expect(mapElementProps('mirror', { refl: 0.98 }).reflectivity).toBe(0.98);
    expect(mapElementProps('bs', { R: 0.3 }).reflectivity).toBe(0.3);
    expect(mapElementProps('polarizer', { axisDeg: 45 }).axisAngleDeg).toBe(45);
    expect(mapElementProps('waveplate', { axisDeg: 30 }).fastAxisAngleDeg).toBe(30);
    expect(mapElementProps('source', {
      wavelength_nm: 530,
      forward_cm: 100,
      backward_cm: 0,
      polPreset: 'Linear Y',
      waist_w0_um: 300,
    })).toMatchObject({
      wavelength_nm: 530,
      forward_cm: 100,
      backward_cm: 0,
      polPreset: 'V',
      waist_um: 300,
    });
  });
});

describe('sceneFromUpstream', () => {
  it('builds a valid snapshot with kinds, poses and camera', () => {
    const scene = sceneFromUpstream({
      sceneId: 'live-scene',
      seed: 42,
      camera: {
        position: { x: 0.06, y: 0.04, z: 0.08 },
        target: { x: 0, y: 0.03, z: 0 },
        fov: Math.PI / 3,
      },
      elements: [
        {
          uuid: '3f0f6e9c-1d9b-4c2a-8f3e-0f6f2d1a4b5c',
          type: 'mirror',
          mesh: pose(0, 0, 0.135),
          props: { flat: true, R: 2, refl: 0.99, label: 'M1' },
        },
        {
          uuid: '4f0f6e9c-1d9b-4c2a-8f3e-0f6f2d1a4b5c',
          type: 'lens',
          mesh: pose(0, 0, 0.05, [0, 0.3826834, 0, 0.9238795]),
          props: { f: 0.05 },
        },
        {
          uuid: '5f0f6e9c-1d9b-4c2a-8f3e-0f6f2d1a4b5c',
          type: 'ruler',
          mesh: pose(),
        },
      ],
      sources: [
        {
          uuid: '6f0f6e9c-1d9b-4c2a-8f3e-0f6f2d1a4b5c',
          group: pose(0, 0, 0),
          props: {
            wavelength_nm: 530,
            forward_cm: 100,
            backward_cm: 0,
            polPreset: 'Linear X',
            waist_w0_um: 200,
          },
        },
      ],
    });

    expect(validateScene(scene).valid).toBe(true);
    expect(scene.sceneId).toBe('live-scene');
    expect(scene.seed).toBe(42);
    expect(scene.elements).toHaveLength(3); // ruler skipped
    const kinds = scene.elements.map((element) => element.kind).sort();
    expect(kinds).toEqual(['lens', 'mirror', 'source']);
    expect(scene.elements.find((element) => element.kind === 'mirror')?.name).toBe('M1');
    expect(scene.camera.position).toEqual([0.06, 0.04, 0.08]);
    expect(scene.camera.fov).toBeCloseTo(Math.PI / 3, 12);
  });

  it('normalizes quaternions and defaults missing values', () => {
    const scene = sceneFromUpstream({
      sceneId: 'normalize',
      camera: {
        position: { x: 0, y: 1, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        fov: 1,
      },
      elements: [{
        uuid: '7f0f6e9c-1d9b-4c2a-8f3e-0f6f2d1a4b5c',
        type: 'lens',
        mesh: pose(0, 0, 0, [0, 0, 0, 2]),
        props: {},
      }],
      sources: [],
    });

    const element = scene.elements[0];
    expect(element.pose.orientation).toEqual([0, 0, 0, 1]);
    expect(element.props.focalLength_m).toBe(0.1);
    expect(validateScene(scene).valid).toBe(true);
  });
});

describe('SceneMirror revisions', () => {
  it('advances revision on sync and returns isolated snapshots', () => {
    const initial = createEmptyScene(undefined, 1);
    const mirror = new SceneMirror(initial);

    const next = createEmptyScene(undefined, 2);
    const revision = mirror.sync(next);

    expect(mirror.getRevision()).toBe(initial.revision + 1);
    expect(revision).toBe(mirror.getRevision());
    expect(mirror.getScene().seed).toBe(2);

    const copy = mirror.getScene();
    copy.elements.push(copy.elements[0]);
    expect(mirror.getScene().elements).toHaveLength(0);
  });

  it('rejects invalid snapshots without replacing state', () => {
    const mirror = new SceneMirror(createEmptyScene(undefined, 1));
    const revision = mirror.getRevision();
    const bad = createEmptyScene(undefined, 2);
    bad.revision = -3;

    expect(() => mirror.sync(bad)).toThrow(/Invalid scene snapshot/);
    expect(mirror.getRevision()).toBe(revision);
    expect(mirror.getScene().seed).toBe(1);
  });
});

describe('SceneMirror reads', () => {
  let mirror: SceneMirror;

  beforeEach(() => {
    mirror = new SceneMirror(createEmptyScene(undefined, 42));
  });

  it('serves get_state and rejects stale revisions', async () => {
    const state = await mirror.execute(mirrorRequest({
      expectedRevision: mirror.getRevision(),
    }));
    expect(state.ok).toBe(true);
    expect((state.result as { seed: number }).seed).toBe(42);

    const stale = await mirror.execute(mirrorRequest({
      requestId: 'stale',
      expectedRevision: mirror.getRevision() + 1,
    }));
    expect(stale.error).toBe('STALE_REVISION');
  });

  it('rejects mutating methods', async () => {
    const response = await mirror.execute(mirrorRequest({
      method: 'add',
      expectedRevision: mirror.getRevision(),
      args: { kind: 'mirror' },
    }));
    expect(response.error).toBe('UNSUPPORTED');
  });

  it('observes mapped detectors', async () => {
    const scene = sceneFromUpstream({
      sceneId: 'observe',
      camera: {
        position: { x: 0, y: 1, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        fov: 1,
      },
      elements: [{
        uuid: '8f0f6e9c-1d9b-4c2a-8f3e-0f6f2d1a4b5c',
        type: 'multimeter',
        mesh: pose(0, 0, 0.2),
        props: {},
      }],
      sources: [{
        uuid: '9f0f6e9c-1d9b-4c2a-8f3e-0f6f2d1a4b5c',
        group: pose(0, 0, 0),
        props: {
          wavelength_nm: 532,
          forward_cm: 100,
          backward_cm: 0,
          polPreset: 'Linear X',
          waist_w0_um: 200,
        },
      }],
    });
    mirror.sync(scene);

    const response = await mirror.execute(mirrorRequest({
      requestId: 'observe',
      method: 'observe',
      expectedRevision: mirror.getRevision(),
    }));

    expect(response.ok).toBe(true);
    const observation = response.result as {
      revision: number;
      detectors: Array<{ hit: boolean; receivedRatio: number }>;
      traceStatus: string;
    };
    expect(observation.revision).toBe(mirror.getRevision());
    expect(observation.traceStatus).toBe('OK');
    expect(observation.detectors).toHaveLength(1);
    expect(observation.detectors[0].hit).toBe(true);
    expect(observation.detectors[0].receivedRatio).toBeGreaterThan(0.9);
  });

  it('serializes the scene through save_scene', async () => {
    const response = await mirror.execute(mirrorRequest({
      method: 'save_scene',
      expectedRevision: mirror.getRevision(),
    }));
    expect(response.ok).toBe(true);
    const result = response.result as { json: string; bytes: number };
    expect(result.bytes).toBeGreaterThan(0);
    expect(JSON.parse(result.json).version).toBe(1);
  });

  it('runs BB84 at the current revision and reports its engine/hash', async () => {
    const response = await mirror.execute(mirrorRequest({
      requestId: 'bb84-1',
      method: 'run_bb84',
      expectedRevision: mirror.getRevision(),
      args: {
        pulses: 2000,
        seed: 11,
        model: {
          transmission: 1,
          detectorEfficiency: 1,
          darkCountProbability: 0,
          misalignmentRad: 0.1,
        },
      },
    }));

    expect(response.ok).toBe(true);
    const report = response.result as {
      pulses: number;
      engineCommit: string;
      opticalHash: string;
      sifted: { length: number; qber: number };
      sceneRevision: number;
    };
    expect(report.pulses).toBe(2000);
    expect(report.engineCommit).toBe('bb84-v1');
    expect(report.opticalHash).toMatch(/^[0-9a-f]{8}$/);
    expect(report.sifted.length).toBeGreaterThan(0);
    expect(report.sifted.qber).toBeGreaterThan(0);
    expect(report.sceneRevision).toBe(mirror.getRevision());
  });

  it('rejects invalid BB84 pulses and stale revisions', async () => {
    const invalid = await mirror.execute(mirrorRequest({
      requestId: 'bb84-invalid',
      method: 'run_bb84',
      expectedRevision: mirror.getRevision(),
      args: { pulses: 0, seed: 1 },
    }));
    expect(invalid.error).toBe('VALIDATION');

    const stale = await mirror.execute(mirrorRequest({
      requestId: 'bb84-stale',
      method: 'run_bb84',
      expectedRevision: mirror.getRevision() + 1,
      args: { pulses: 10, seed: 1 },
    }));
    expect(stale.error).toBe('STALE_REVISION');
  });

  it('is idempotent per requestId and rejects conflicting args', async () => {
    const request = mirrorRequest({
      method: 'get_state',
      expectedRevision: mirror.getRevision(),
    });
    const first = await mirror.execute(request);
    const second = await mirror.execute(request);
    expect(second).toEqual(first);

    const conflict = await mirror.execute({
      ...request,
      args: { different: true },
    });
    expect(conflict.error).toBe('VALIDATION');
  });
});

describe('SceneMirror capture', () => {
  class FakeCapture {
    calls: Array<{ view: CaptureView; revision: number }> = [];
    failWith?: string;
    frameCounter = 0;

    async capture(view: CaptureView, revision: number): Promise<CaptureResult> {
      this.calls.push({ view, revision });
      if (this.failWith) throw new CaptureError(this.failWith as never, 'fake failure');
      this.frameCounter++;
      return {
        revision,
        view,
        frameId: this.frameCounter,
        blob: new Blob(['png'], { type: 'image/png' }),
        bytes: 3,
        width: 1280,
        height: 720,
      };
    }
  }

  it('captures at the current revision and caches retries', async () => {
    const capture = new FakeCapture();
    const mirror = new SceneMirror(createEmptyScene(), { capture });
    const revision = mirror.getRevision();

    const request = mirrorRequest({
      requestId: 'cap-1',
      method: 'capture',
      args: { view: 'top' },
      expectedRevision: revision,
    });
    const first = await mirror.execute(request);
    const second = await mirror.execute(request);

    expect(first.ok).toBe(true);
    expect((first.result as { view: string }).view).toBe('top');
    expect(second).toEqual(first);
    expect(capture.calls).toEqual([{ view: 'top', revision }]);
  });

  it('validates the view and maps capture errors', async () => {
    const capture = new FakeCapture();
    const mirror = new SceneMirror(createEmptyScene(), { capture });
    const revision = mirror.getRevision();

    const badView = await mirror.execute(mirrorRequest({
      requestId: 'cap-bad',
      method: 'capture',
      args: { view: 'diagonal' },
      expectedRevision: revision,
    }));
    expect(badView.error).toBe('VALIDATION');

    capture.failWith = 'LIMIT';
    const failed = await mirror.execute(mirrorRequest({
      requestId: 'cap-fail',
      method: 'capture',
      args: { view: 'top' },
      expectedRevision: revision,
    }));
    expect(failed.error).toBe('LIMIT');
  });

  it('reports UNSUPPORTED when no capture service is attached', async () => {
    const mirror = new SceneMirror(createEmptyScene());
    const response = await mirror.execute(mirrorRequest({
      requestId: 'cap-none',
      method: 'capture',
      args: { view: 'top' },
      expectedRevision: mirror.getRevision(),
    }));
    expect(response.error).toBe('UNSUPPORTED');
  });
});
