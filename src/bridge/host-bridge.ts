/**
 * BB-09 Restricted host bridge
 *
 * Owns the iframe-side handshake and the serial command queue. The bridge:
 * - validates event.origin against an explicit allow-list (no '*')
 * - requires a transferred MessagePort from a real event.source
 * - rebuilds every request through the protocol validator
 * - enforces request size and queue bounds
 * - lets the executor's idempotency cache handle duplicate requestIds
 */

import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_QUEUE,
  MAX_REQUEST_BYTES,
  ReadyMessage,
  isHandshakeMessage,
  validateAllowedOrigins,
  validateRequest,
} from './protocol';
import type { CommandRequest, CommandResponse } from '../domain/commands';

export interface MessagePortLike {
  postMessage(message: unknown): void;
  start?(): void;
  addEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
}

export interface HandshakeEventLike {
  origin: string;
  source: unknown;
  data: unknown;
  ports: ArrayLike<MessagePortLike>;
}

export interface ExecutorLike {
  execute(request: CommandRequest): Promise<CommandResponse>;
  getRevision(): number;
}

export interface HostBridgeOptions {
  allowedOrigins: readonly string[];
  executor: ExecutorLike;
  maxQueue?: number;
  maxRequestBytes?: number;
}

export class HostBridge {
  private allowedOrigins: ReadonlySet<string>;
  private executor: ExecutorLike;
  private maxQueue: number;
  private maxRequestBytes: number;
  private port: MessagePortLike | null = null;
  private listener: ((event: { data: unknown }) => void) | null = null;
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: HostBridgeOptions) {
    const originError = validateAllowedOrigins(options.allowedOrigins);
    if (originError) throw new Error(originError);
    if (!options.executor || typeof options.executor.execute !== 'function') {
      throw new Error('HostBridge requires a command executor');
    }

    this.allowedOrigins = new Set(options.allowedOrigins);
    this.executor = options.executor;
    this.maxQueue = options.maxQueue ?? MAX_QUEUE;
    this.maxRequestBytes = options.maxRequestBytes ?? MAX_REQUEST_BYTES;
  }

  get attached(): boolean {
    return this.port !== null;
  }

  /**
   * Handle a window 'message' event. Returns true when the event was a valid
   * handshake and the port is now attached.
   */
  handleHandshake(event: HandshakeEventLike): boolean {
    if (!event || typeof event.origin !== 'string' ||
        !this.allowedOrigins.has(event.origin)) {
      return false;
    }
    if (!event.source) return false;
    if (!isHandshakeMessage(event.data)) return false;
    if (!event.ports || event.ports.length === 0) return false;

    this.attach(event.ports[0]);
    return true;
  }

  attach(port: MessagePortLike): void {
    if (this.port) this.detach();

    this.port = port;
    this.listener = (event) => {
      void this.enqueue(event.data);
    };

    port.start?.();
    if (port.addEventListener) {
      port.addEventListener('message', this.listener);
    } else {
      port.onmessage = this.listener;
    }

    const ready: ReadyMessage = {
      type: 'beambench:ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      revision: this.executor.getRevision(),
    };
    port.postMessage(ready);
  }

  detach(): void {
    if (!this.port) return;
    if (this.listener) {
      if (this.port.removeEventListener) {
        this.port.removeEventListener('message', this.listener);
      } else if (this.port.onmessage === this.listener) {
        this.port.onmessage = null;
      }
    }
    this.port = null;
    this.listener = null;
  }

  private enqueue(data: unknown): void {
    if (this.pending >= this.maxQueue) {
      this.postBusy(data);
      return;
    }

    this.pending++;
    this.queue = this.queue
      .then(() => this.handleRequest(data))
      .catch(() => {
        // Errors are reported per-request; the queue must stay alive.
      })
      .finally(() => {
        this.pending--;
      });
  }

  private postBusy(data: unknown): void {
    const requestId = data && typeof data === 'object' &&
      typeof (data as { requestId?: unknown }).requestId === 'string'
      ? (data as { requestId: string }).requestId
      : '';
    this.port?.postMessage({
      requestId,
      ok: false,
      error: 'BUSY',
    } satisfies CommandResponse);
  }

  private async handleRequest(data: unknown): Promise<void> {
    const requestId = data && typeof data === 'object' &&
      typeof (data as { requestId?: unknown }).requestId === 'string'
      ? (data as { requestId: string }).requestId
      : '';

    const validation = validateRequest(data, this.maxRequestBytes);
    if (!validation.ok || !validation.request) {
      this.port?.postMessage({
        requestId,
        ok: false,
        error: 'VALIDATION',
        result: { message: validation.error },
      } satisfies CommandResponse);
      return;
    }

    try {
      const response = await this.executor.execute(validation.request);
      this.port?.postMessage(response);
    } catch (err) {
      this.port?.postMessage({
        requestId,
        ok: false,
        error: 'TRACE_FAILED',
        result: { message: (err as Error)?.message ?? String(err) },
      } satisfies CommandResponse);
    }
  }
}
