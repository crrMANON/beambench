/**
 * BB-10 capture tests with an injected renderer (no WebGL required).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CaptureError,
  CaptureService,
  CaptureView,
  MAX_CAPTURE_BYTES,
} from '../../src/render/capture';

interface Harness {
  service: CaptureService;
  state: {
    revision: number;
    renderCalls: number;
    views: CaptureView[];
    blob: Blob | null;
    revisionDrift: number;
    revisionCalls: number;
    width: number;
    height: number;
    captures: number;
  };
}

function makeHarness(overrides: Partial<{ maxBytes: number; blob: Blob | null }> = {}): Harness {
  const state: Harness['state'] = {
    revision: 3,
    renderCalls: 0,
    views: [],
    blob: 'blob' in overrides
      ? overrides.blob as Blob | null
      : new Blob([new Uint8Array(1024)], { type: 'image/png' }),
    revisionDrift: 0,
    revisionCalls: 0,
    width: 1280,
    height: 720,
    captures: 0,
  };

  const canvas = {
    width: state.width,
    height: state.height,
  } as unknown as HTMLCanvasElement;

  const service = new CaptureService({
    getRevision: () => {
      state.revisionCalls++;
      const drift = state.revisionCalls > 1 ? state.revisionDrift : 0;
      return state.revision + drift;
    },
    setView: (view) => {
      state.views.push(view);
    },
    render: () => {
      state.renderCalls++;
      state.captures++;
    },
    canvas,
    maxBytes: overrides.maxBytes,
    toBlob: async () => state.blob,
  });

  return { service, state };
}

describe('CaptureService', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('captures the requested view at the expected revision', async () => {
    const result = await harness.service.capture('top', 3);

    expect(result).toMatchObject({
      revision: 3,
      view: 'top',
      width: 1280,
      height: 720,
      bytes: 1024,
    });
    expect(result.blob).toBe(harness.state.blob);
    expect(harness.state.renderCalls).toBe(1);
    expect(harness.state.views).toEqual(['top']);
  });

  it('rejects a stale revision without rendering', async () => {
    await expect(harness.service.capture('front', 2))
      .rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(harness.state.renderCalls).toBe(0);
  });

  it('rejects when the revision changes during capture', async () => {
    harness.state.revisionDrift = 1;
    await expect(harness.service.capture('side', 3))
      .rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(harness.state.renderCalls).toBe(1);
  });

  it('rejects empty images', async () => {
    const empty = makeHarness({ blob: new Blob([], { type: 'image/png' }) });
    await expect(empty.service.capture('top', 3))
      .rejects.toMatchObject({ code: 'CAPTURE_FAILED' });
  });

  it('rejects a null renderer result', async () => {
    const none = makeHarness({ blob: null });
    await expect(none.service.capture('top', 3))
      .rejects.toBeInstanceOf(CaptureError);
  });

  it('rejects images larger than the limit', async () => {
    const small = makeHarness({ maxBytes: 100 });
    await expect(small.service.capture('top', 3))
      .rejects.toMatchObject({ code: 'LIMIT' });
    expect(MAX_CAPTURE_BYTES).toBe(4 * 1024 * 1024);
  });

  it('increments frame ids and does not retain frames across 100 captures', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 100; i++) {
      const result = await harness.service.capture('perspective', 3);
      ids.push(result.frameId);
    }

    expect(new Set(ids).size).toBe(100);
    expect(ids[0]).toBe(1);
    expect(ids.at(-1)).toBe(100);
    expect(harness.state.renderCalls).toBe(100);
  });

  it('validates the expected revision argument', async () => {
    await expect(harness.service.capture('top', -1))
      .rejects.toMatchObject({ code: 'STALE_REVISION' });
    await expect(harness.service.capture('top', 1.5))
      .rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(harness.state.renderCalls).toBe(0);
  });
});
