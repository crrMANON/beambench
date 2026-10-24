/**
 * BB-09 host bridge tests: origin allow-list, handshake, request validation,
 * size/queue bounds, serial execution and idempotent retries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HostBridge, MessagePortLike } from '../../src/bridge/host-bridge';
import {
  MAX_REQUEST_BYTES,
  messageBytes,
  validateAllowedOrigins,
} from '../../src/bridge/protocol';
import { CommandExecutor } from '../../src/domain/commands';
import { CommandRequest, CommandResponse } from '../../src/domain/commands';

class FakePort implements MessagePortLike {
  sent: unknown[] = [];
  listener: ((event: { data: unknown }) => void) | null = null;
  removed = false;

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  start(): void {
    // no-op
  }

  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listener = listener;
  }

  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    if (this.listener === listener) this.listener = null;
    this.removed = true;
  }

  deliver(data: unknown): void {
    this.listener?.({ data });
  }
}

class BlockingExecutor {
  calls: CommandRequest[] = [];
  resolvers: Array<(response: CommandResponse) => void> = [];

  execute(request: CommandRequest): Promise<CommandResponse> {
    this.calls.push(request);
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  getRevision(): number {
    return 0;
  }
}

const ORIGIN = 'https://host.example';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function validRequest(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    protocolVersion: 1,
    requestId: 'req-1',
    expectedRevision: 0,
    method: 'get_state',
    args: null,
    ...overrides,
  };
}

describe('Origin configuration', () => {
  it('rejects wildcard and empty allow-lists', () => {
    expect(validateAllowedOrigins([])).toMatch(/at least one/);
    expect(validateAllowedOrigins(['*'])).toMatch(/Wildcard/);
    expect(validateAllowedOrigins(['https://*.example'])).toMatch(/Wildcard/);
    expect(validateAllowedOrigins(['not-a-url'])).toMatch(/Invalid origin/);
    expect(validateAllowedOrigins(['https://host.example/path'])).toMatch(/scheme/);
    expect(validateAllowedOrigins([ORIGIN])).toBeNull();
  });

  it('refuses to construct with a wildcard origin', () => {
    expect(() => new HostBridge({
      allowedOrigins: ['*'],
      executor: new CommandExecutor(),
    })).toThrow(/Wildcard/);
  });
});

describe('Handshake', () => {
  let bridge: HostBridge;
  let port: FakePort;

  beforeEach(() => {
    bridge = new HostBridge({ allowedOrigins: [ORIGIN], executor: new CommandExecutor() });
    port = new FakePort();
  });

  it('accepts an allowed origin and posts a ready message', () => {
    const attached = bridge.handleHandshake({
      origin: ORIGIN,
      source: {},
      data: { type: 'beambench:hello', protocolVersion: 1 },
      ports: [port],
    });

    expect(attached).toBe(true);
    expect(bridge.attached).toBe(true);
    expect(port.sent[0]).toEqual({
      type: 'beambench:ready',
      protocolVersion: 1,
      revision: 0,
    });
  });

  it('rejects disallowed origins', () => {
    expect(bridge.handleHandshake({
      origin: 'https://evil.example',
      source: {},
      data: { type: 'beambench:hello', protocolVersion: 1 },
      ports: [port],
    })).toBe(false);
    expect(bridge.attached).toBe(false);
  });

  it('rejects missing source, wrong protocol and missing port', () => {
    const base = {
      origin: ORIGIN,
      source: {},
      data: { type: 'beambench:hello', protocolVersion: 1 },
      ports: [port],
    };
    expect(bridge.handleHandshake({ ...base, source: null })).toBe(false);
    expect(bridge.handleHandshake({
      ...base,
      data: { type: 'beambench:hello', protocolVersion: 2 },
    })).toBe(false);
    expect(bridge.handleHandshake({ ...base, ports: [] })).toBe(false);
    expect(bridge.attached).toBe(false);
  });

  it('detaches the previous port when a new handshake arrives', () => {
    bridge.handleHandshake({
      origin: ORIGIN,
      source: {},
      data: { type: 'beambench:hello', protocolVersion: 1 },
      ports: [port],
    });
    const next = new FakePort();
    bridge.handleHandshake({
      origin: ORIGIN,
      source: {},
      data: { type: 'beambench:hello', protocolVersion: 1 },
      ports: [next],
    });

    expect(port.removed).toBe(true);
    expect(bridge.attached).toBe(true);
    expect(next.sent[0]).toMatchObject({ type: 'beambench:ready' });
  });
});

describe('Request handling', () => {
  let bridge: HostBridge;
  let port: FakePort;
  let executor: CommandExecutor;

  beforeEach(() => {
    executor = new CommandExecutor();
    bridge = new HostBridge({ allowedOrigins: [ORIGIN], executor });
    port = new FakePort();
    bridge.attach(port);
  });

  it('executes a valid command and returns the response', async () => {
    port.deliver(validRequest());
    await flush();

    expect(port.sent.at(-1)).toMatchObject({
      requestId: 'req-1',
      ok: true,
      revision: 0,
    });
  });

  it('rejects unsupported protocol versions and methods', async () => {
    port.deliver(validRequest({ protocolVersion: 2 as 1 }));
    port.deliver(validRequest({ requestId: 'req-2', method: 'eval' as never }));
    await flush();

    const responses = port.sent.slice(1) as Array<{ error: string }>;
    expect(responses[0].error).toBe('VALIDATION');
    expect(responses[1].error).toBe('VALIDATION');
  });

  it('rejects oversized requests before execution', async () => {
    const small = new HostBridge({
      allowedOrigins: [ORIGIN],
      executor,
      maxRequestBytes: 64,
    });
    const smallPort = new FakePort();
    small.attach(smallPort);

    smallPort.deliver(validRequest({ args: { blob: 'x'.repeat(200) } }));
    await flush();

    expect(smallPort.sent.at(-1)).toMatchObject({ error: 'VALIDATION' });
    expect(messageBytes({ blob: 'x'.repeat(200) })).toBeLessThan(MAX_REQUEST_BYTES);
  });

  it('is idempotent for repeated requestIds', async () => {
    port.deliver(validRequest({ requestId: 'same' }));
    await flush();
    port.deliver(validRequest({ requestId: 'same' }));
    await flush();

    const responses = port.sent.slice(1);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toEqual(responses[1]);
  });

  it('rejects a reused requestId with different arguments', async () => {
    port.deliver(validRequest({ requestId: 'conflict' }));
    await flush();
    port.deliver(validRequest({ requestId: 'conflict', args: { other: true } }));
    await flush();

    expect(port.sent.at(-1)).toMatchObject({ ok: false, error: 'VALIDATION' });
  });

  it('keeps mutations serial and reports BUSY past the queue bound', async () => {
    const blocking = new BlockingExecutor();
    const limited = new HostBridge({
      allowedOrigins: [ORIGIN],
      executor: blocking,
      maxQueue: 2,
    });
    const limitedPort = new FakePort();
    limited.attach(limitedPort);

    limitedPort.deliver(validRequest({ requestId: 'a' }));
    limitedPort.deliver(validRequest({ requestId: 'b' }));
    limitedPort.deliver(validRequest({ requestId: 'c' }));
    await flush();

    // Only one request is executing; the third is rejected instead of queued.
    expect(blocking.calls).toHaveLength(1);
    expect(limitedPort.sent.at(-1)).toMatchObject({ requestId: 'c', error: 'BUSY' });

    blocking.resolvers[0]({ requestId: 'a', ok: true, revision: 0 });
    await flush();
    expect(blocking.calls).toHaveLength(2);

    blocking.resolvers[1]({ requestId: 'b', ok: true, revision: 0 });
    await flush();
    expect(blocking.calls).toHaveLength(2);
  });

  it('does not execute requests after detach', async () => {
    bridge.detach();
    port.deliver(validRequest());
    await flush();
    expect(port.sent).toHaveLength(1); // only the ready message
  });
});
