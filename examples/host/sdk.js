/**
 * Minimal BeamBench host SDK (BB-09).
 *
 * Usage:
 *   import { connect } from './sdk.js';
 *   const bb = await connect({ iframe, origin: 'https://host.example' });
 *   const state = await bb.request('get_state');
 *
 * The SDK never evaluates page scripts and never guesses an origin; callers
 * must pass the exact origin configured in the embedding page.
 */

const PROTOCOL_VERSION = 1;

export async function connect({ iframe, origin, timeoutMs = 5000 }) {
  if (!iframe?.contentWindow) throw new Error('connect requires an iframe');
  if (!origin || origin.includes('*')) throw new Error('An explicit origin is required');

  const channel = new MessageChannel();
  const pending = new Map();
  let revision = 0;
  let sequence = 0;
  let closed = false;

  const api = {
    get revision() {
      return revision;
    },
    request(method, args = null, options = {}) {
      if (closed) return Promise.reject(new Error('Bridge closed'));
      const requestId = options.requestId ||
        (globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${sequence++}`);
      const request = {
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        expectedRevision: options.expectedRevision ?? revision,
        method,
        args,
      };

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Request timed out: ${method}`));
        }, options.timeoutMs ?? timeoutMs);

        pending.set(requestId, {
          resolve: (response) => {
            clearTimeout(timer);
            if (typeof response.revision === 'number') revision = response.revision;
            resolve(response);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        channel.port1.postMessage(request);
      });
    },
    getState(options) {
      return api.request('get_state', null, options);
    },
    observe(options) {
      return api.request('observe', null, options);
    },
    close() {
      closed = true;
      channel.port1.close?.();
      channel.port2.close?.();
      for (const entry of pending.values()) entry.reject(new Error('Bridge closed'));
      pending.clear();
    },
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Handshake timed out'));
    }, timeoutMs);

    channel.port1.onmessage = (event) => {
      const message = event.data;
      if (message?.type === 'beambench:ready') {
        clearTimeout(timer);
        if (typeof message.revision === 'number') revision = message.revision;
        resolve();
        return;
      }
      const entry = pending.get(message?.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      entry.resolve(message);
    };
    channel.port1.start?.();

    iframe.contentWindow.postMessage(
      { type: 'beambench:hello', protocolVersion: PROTOCOL_VERSION },
      origin,
      [channel.port2]
    );
  });

  return api;
}
