import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHashPool, EMPTY_SHA256, nativeHashService, type HashWorkerPort } from './sha256-pool';
import { deletionFixture } from '../../tests/deletion-fixture';
import { executeDeletion, makeDeletionPlan } from './file-deletion';

/** Message/transfer adapter only: uses real SHA-256, never real filesystem access. */
class TestWorker implements HashWorkerPort {
  onmessage: HashWorkerPort['onmessage'] = null;
  onerror: HashWorkerPort['onerror'] = null;
  onmessageerror: HashWorkerPort['onmessageerror'] = null;
  terminated = false;
  received = 0;
  busy = false;
  constructor(ready = true) {
    if (ready) setTimeout(() => this.onmessage?.({ data: { type: 'ready', hex: EMPTY_SHA256 } }), 0);
  }
  postMessage(message: { id: number; buffer: ArrayBuffer }, transfer: ArrayBuffer[]) {
    expect(this.busy).toBe(false); this.busy = true; this.received++;
    const copy = structuredClone(message, { transfer });
    setTimeout(async () => {
      const result = await nativeHashService().digest(copy.buffer);
      this.busy = false;
      if (!this.terminated) this.onmessage?.({ data: { id: copy.id, ...result } });
    }, 5);
  }
  terminate() { this.terminated = true; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('./sha256-browser'); });

describe('fresh full SHA-256 in a task-local worker pool', () => {
  it('matches known vectors, transfers input buffers, bounds workers and preserves request identity', async () => {
    const ports: TestWorker[] = [];
    const pool = await createHashPool(() => { const p = new TestWorker(); ports.push(p); return p; }, 99);
    try {
      const inputs = ['', 'abc', 'a'.repeat(1_000_000), ...Array.from({ length: 12 }, (_, i) => `file-${i}`)];
      const expected = await Promise.all(inputs.map(text => nativeHashService().digest(new TextEncoder().encode(text).buffer)));
      expect(expected[0].hex).toBe(EMPTY_SHA256);
      expect(expected[1].hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      expect(expected[2].hex).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
      const buffers = inputs.map(text => new TextEncoder().encode(text).buffer);
      const actual = await Promise.all(buffers.map(buffer => pool.digest(buffer)));
      expect(actual.map(r => r.hex)).toEqual(expected.map(r => r.hex));
      expect(actual.every(r => r.backend === 'worker' && r.computeMs >= 0)).toBe(true);
      expect(buffers.every(buffer => buffer.byteLength === 0)).toBe(true);
      expect(ports).toHaveLength(4);
      expect(ports.reduce((n, port) => n + port.received, 0)).toBe(inputs.length);
    } finally { pool.dispose(); }
    expect(ports.every(port => port.terminated)).toBe(true);
    await expect(pool.digest(new ArrayBuffer(1))).rejects.toThrow('已结束');
  });

  it.each(['constructor', 'timeout', 'self-test'] as const)('falls back with FULL hashing only before transfer on %s failure', async reason => {
    const ports: TestWorker[] = [];
    const pool = await createHashPool(() => {
      if (reason === 'constructor') throw new Error('CSP');
      const port = new TestWorker(false); ports.push(port);
      if (reason === 'self-test') setTimeout(() => port.onmessage?.({ data: { type: 'ready', hex: 'wrong' } }), 0);
      return port;
    }, 4, 10);
    const result = await pool.digest(new TextEncoder().encode('abc').buffer);
    expect(result.backend).toBe('main');
    expect(result.hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(ports.every(p => p.terminated && p.received === 0)).toBe(true);
    pool.dispose();
  });

  it.each(['error', 'messageerror', 'wrong-id', 'bad-digest', 'timeout', 'dispose'] as const)(
    'fails closed and settles all active/queued work on %s, with no detached-buffer retry', async reason => {
      const ports: TestWorker[] = [];
      const pool = await createHashPool(() => {
        const port = new TestWorker(); ports.push(port);
        port.postMessage = () => { port.received++; };
        return port;
      }, 2, 1000, 15);
      const settled = Promise.allSettled(Array.from({ length: 7 }, () => pool.digest(new ArrayBuffer(3))));
      if (reason === 'error') ports[0].onerror?.({ preventDefault() {} });
      if (reason === 'messageerror') ports[0].onmessageerror?.(new MessageEvent('messageerror'));
      if (reason === 'wrong-id') ports[0].onmessage?.({ data: { id: 999, hex: EMPTY_SHA256, computeMs: 1 } });
      if (reason === 'bad-digest') ports[0].onmessage?.({ data: { id: 1, hex: '', computeMs: 1 } });
      if (reason === 'dispose') pool.dispose();
      expect((await settled).every(result => result.status === 'rejected')).toBe(true);
      expect(ports.every(p => p.terminated)).toBe(true);
      expect(ports.reduce((n, p) => n + p.received, 0)).toBe(2);
      await expect(pool.digest(new ArrayBuffer(1))).rejects.toThrow();
    },
  );

  it('uses the browser path, still detects changed keepers, and disposes the pool at completion', async () => {
    const ports: TestWorker[] = [];
    vi.stubGlobal('Worker', TestWorker);
    vi.doMock('./sha256-browser', () => ({ createBrowserHashService: () => createHashPool(() => {
      const port = new TestWorker(); ports.push(port); return port;
    }) }));
    const f = await deletionFixture({ selectedCount: 3 });
    const keeper = f.groups[0].files[0];
    const remove = f.root.removeEntry;
    f.root.removeEntry = async (name, options) => {
      await remove(name, options);
      f.files.set(keeper.name, new File([new Uint8Array(1024).fill(1)], keeper.name, { lastModified: 1234 }));
    };
    const plan = makeDeletionPlan(f.groups, [f.groups[0].id], f.groups[0].files.filter(f => f.selected).map(f => f.id), f.access);
    const results = await executeDeletion(f.access, plan, { cancelled: false });
    expect(results.map(r => r.status)).toEqual(['deleted', 'failed', 'failed']);
    expect(f.removed).toHaveLength(1);
    expect(ports.length).toBe(4);
    expect(ports.every(p => p.terminated)).toBe(true);
  });

  it.each(['worker-failed', 'cancelled'] as const)('does not delete while a full check is %s', async reason => {
    const token = { cancelled: false };
    const ports: TestWorker[] = [];
    vi.stubGlobal('Worker', TestWorker);
    vi.doMock('./sha256-browser', () => ({ createBrowserHashService: () => createHashPool(() => {
      const port = new TestWorker(); ports.push(port);
      if (reason === 'worker-failed') port.postMessage = () => setTimeout(() => port.onerror?.({ preventDefault() {} }), 0);
      else {
        const send = port.postMessage.bind(port);
        port.postMessage = (message, transfer) => { token.cancelled = true; send(message, transfer); };
      }
      return port;
    }) }));
    const f = await deletionFixture({ groupCount: 3, selectedCount: 2 });
    const plan = makeDeletionPlan(f.groups, f.groups.map(g => g.id),
      f.groups.flatMap(g => g.files.filter(f => f.selected).map(f => f.id)), f.access);
    const results = await executeDeletion(f.access, plan, token);
    expect(results.every(r => r.status !== 'deleted')).toBe(true);
    expect(f.removed).toHaveLength(0);
    expect(ports.every(p => p.terminated)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(f.removed).toHaveLength(0);
  });
});
