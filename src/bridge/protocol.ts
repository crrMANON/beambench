/**
 * BB-09 Host bridge protocol
 *
 * Frozen wire contract between the embedding page and BeamBench (PLAN §3.2):
 * - Handshake over window.postMessage with an explicit target origin and a
 *   transferred MessagePort; wildcard origins are never accepted.
 * - Commands over the port use {protocolVersion, requestId, expectedRevision,
 *   method, args} and receive {requestId, ok, revision, result, error}.
 * - Size limits are enforced before parsing reaches the executor.
 */

import type { CommandMethod, CommandRequest, CommandResponse } from '../domain/commands';

export const BRIDGE_PROTOCOL_VERSION = 1;
export const MAX_REQUEST_BYTES = 1024 * 1024; // 1 MiB
export const MAX_QUEUE = 16;

export interface HandshakeMessage {
  type: 'beambench:hello';
  protocolVersion: 1;
}

export interface ReadyMessage {
  type: 'beambench:ready';
  protocolVersion: 1;
  revision: number;
}

const VALID_METHODS: ReadonlySet<string> = new Set<CommandMethod>([
  'add', 'remove', 'setPose', 'setParam', 'setDof', 'execute', 'load_scene',
  'reset', 'undo', 'redo', 'get_state', 'observe', 'capture', 'save_scene',
  'run_bb84',
]);

/** Reject wildcard/empty origin configurations outright. */
export function validateAllowedOrigins(origins: readonly string[]): string | null {
  if (!Array.isArray(origins) || origins.length === 0) {
    return 'allowedOrigins must contain at least one explicit origin';
  }
  for (const origin of origins) {
    if (typeof origin !== 'string' || origin.trim().length === 0) {
      return 'allowedOrigins must contain non-empty strings';
    }
    if (origin === '*' || origin.includes('*')) {
      return 'Wildcard origins are not allowed';
    }
    try {
      const url = new URL(origin);
      if (url.origin !== origin) {
        return `Origin must be a scheme://host[:port] string: ${origin}`;
      }
    } catch {
      return `Invalid origin: ${origin}`;
    }
  }
  return null;
}

export function isHandshakeMessage(data: unknown): data is HandshakeMessage {
  return !!data && typeof data === 'object' &&
    (data as HandshakeMessage).type === 'beambench:hello' &&
    (data as HandshakeMessage).protocolVersion === BRIDGE_PROTOCOL_VERSION;
}

/** Byte size of a message as UTF-8 JSON. */
export function messageBytes(data: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(data)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface RequestValidation {
  ok: boolean;
  error?: string;
  request?: CommandRequest;
}

/** Validate and rebuild an untrusted request (never pass raw objects through). */
export function validateRequest(data: unknown, maxBytes: number): RequestValidation {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Request must be an object' };
  }
  if (messageBytes(data) > maxBytes) {
    return { ok: false, error: 'Request exceeds size limit' };
  }

  const raw = data as Record<string, unknown>;
  if (raw.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    return { ok: false, error: 'Unsupported protocolVersion' };
  }
  if (typeof raw.requestId !== 'string' || raw.requestId.length === 0 ||
      raw.requestId.length > 256) {
    return { ok: false, error: 'Invalid requestId' };
  }
  if (!Number.isInteger(raw.expectedRevision) || (raw.expectedRevision as number) < 0) {
    return { ok: false, error: 'Invalid expectedRevision' };
  }
  if (typeof raw.method !== 'string' || !VALID_METHODS.has(raw.method)) {
    return { ok: false, error: 'Unsupported method' };
  }

  return {
    ok: true,
    request: {
      protocolVersion: 1,
      requestId: raw.requestId,
      expectedRevision: raw.expectedRevision as number,
      method: raw.method as CommandMethod,
      args: raw.args,
    },
  };
}

export type { CommandRequest, CommandResponse };
