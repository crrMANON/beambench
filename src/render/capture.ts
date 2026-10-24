/**
 * BB-10 Same-revision frame capture
 *
 * Guarantees that a captured image corresponds to the revision and camera view
 * it reports:
 * - stale revision is rejected before rendering
 * - a revision change during capture rejects the frame
 * - the renderer is asked for one explicit render (no global
 *   preserveDrawingBuffer)
 * - empty/oversized frames are rejected
 *
 * The renderer is injected so the service can be tested without WebGL.
 */

export type CaptureView = 'perspective' | 'top' | 'front' | 'side';

export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024; // 4 MiB

export type CaptureErrorCode = 'STALE_REVISION' | 'LIMIT' | 'CAPTURE_FAILED';

export class CaptureError extends Error {
  code: CaptureErrorCode;

  constructor(code: CaptureErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CaptureResult {
  revision: number;
  view: CaptureView;
  frameId: number;
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
}

export interface CaptureOptions {
  getRevision: () => number;
  setView: (view: CaptureView) => void;
  render: () => void;
  canvas: HTMLCanvasElement;
  maxBytes?: number;
  toBlob?: (canvas: HTMLCanvasElement) => Promise<Blob | null>;
}

function defaultToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}

export class CaptureService {
  private options: CaptureOptions;
  private frameCounter = 0;

  constructor(options: CaptureOptions) {
    if (!options?.canvas) throw new Error('CaptureService requires a canvas');
    if (typeof options.getRevision !== 'function' ||
        typeof options.setView !== 'function' ||
        typeof options.render !== 'function') {
      throw new Error('CaptureService requires revision, view and render hooks');
    }
    this.options = options;
  }

  async capture(view: CaptureView, expectedRevision: number): Promise<CaptureResult> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new CaptureError('STALE_REVISION', 'Invalid expected revision');
    }
    if (expectedRevision !== this.options.getRevision()) {
      throw new CaptureError('STALE_REVISION', 'Scene revision changed before capture');
    }

    this.options.setView(view);
    // Explicit render for this frame; no global preserveDrawingBuffer.
    this.options.render();

    const blob = await (this.options.toBlob ?? defaultToBlob)(this.options.canvas);

    if (expectedRevision !== this.options.getRevision()) {
      throw new CaptureError('STALE_REVISION', 'Scene revision changed during capture');
    }
    if (!blob) {
      throw new CaptureError('CAPTURE_FAILED', 'Renderer returned no image');
    }
    if (blob.size === 0) {
      throw new CaptureError('CAPTURE_FAILED', 'Captured image is empty');
    }

    const maxBytes = this.options.maxBytes ?? MAX_CAPTURE_BYTES;
    if (blob.size > maxBytes) {
      throw new CaptureError('LIMIT', `Image exceeds ${maxBytes} bytes`);
    }

    const width = this.options.canvas.width;
    const height = this.options.canvas.height;
    if (!(width > 0) || !(height > 0)) {
      throw new CaptureError('CAPTURE_FAILED', 'Canvas has no drawable area');
    }

    this.frameCounter++;
    return {
      revision: expectedRevision,
      view,
      frameId: this.frameCounter,
      blob,
      bytes: blob.size,
      width,
      height,
    };
  }
}
