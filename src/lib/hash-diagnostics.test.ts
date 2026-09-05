import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { PROBE_BYTES, PROBE_HASH, runHashDiagnostics, type DiagnosticCase } from './hash-diagnostics';
import { createWasmDiagnosticHasher } from './sha256-wasm-diagnostic';
import type { HashService } from './sha256-pool';

afterEach(() => { vi.useRealTimers(); });

it('WASM matches known SHA-256 vectors, OpenSSL boundaries and the entire synthetic probe', async () => {
  const hasher = await createWasmDiagnosticHasher();
  const known = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ];
  try {
    for (const [input, hex] of known) {
      expect((await hasher.digest(new TextEncoder().encode(input).buffer)).hex).toBe(hex);
    }
    for (const size of [55, 56, 63, 64, 65, 16383, 16384, 16385, PROBE_BYTES + 1]) {
      const data = Uint8Array.from({ length: size }, (_, i) => (i * 31) % 256);
      const result = await hasher.digest(data.buffer);
      expect(result.hex).toBe(createHash('sha256').update(data).digest('hex'));
      expect(result.computeMs).toBeGreaterThanOrEqual(0);
    }
    const probe = new Uint8Array(PROBE_BYTES).fill(73);
    expect(createHash('sha256').update(probe).digest('hex')).toBe(PROBE_HASH);
    expect((await hasher.digest(probe.buffer)).hex).toBe(PROBE_HASH);
    // A reusable WASM instance must reset completely between unrelated inputs.
    expect((await hasher.digest(new ArrayBuffer(0))).hex).toBe(known[0][1]);
  } finally { hasher.dispose(); }
  await expect(hasher.digest(new ArrayBuffer(1))).rejects.toThrow('自检已结束');
});

it('runs two reverse-order rounds with equal timed byte counts and bounded concurrency', async () => {
  const runs: { test: DiagnosticCase; calls: number; active: number; peak: number; dispose: ReturnType<typeof vi.fn> }[] = [];
  const progress = vi.fn();
  const results = await runHashDiagnostics(async test => {
    const run = { test, calls: 0, active: 0, peak: 0, dispose: vi.fn() }; runs.push(run);
    return {
      async digest(buffer) {
        expect(buffer.byteLength).toBe(PROBE_BYTES);
        expect(new Uint8Array(buffer)[PROBE_BYTES - 1]).toBe(73);
        run.calls++; run.active++; run.peak = Math.max(run.peak, run.active);
        await Promise.resolve(); run.active--;
        return { hex: PROBE_HASH, computeMs: 1, backend: 'worker' };
      }, dispose: run.dispose,
    };
  }, new AbortController().signal, progress);
  expect(runs.map(r => `${r.test.engine}-${r.test.threads}-${r.test.round}`)).toEqual([
    'native-1-1', 'native-4-1', 'wasm-4-1', 'wasm-4-2', 'native-4-2', 'native-1-2',
  ]);
  for (const run of runs) {
    expect(run.calls - run.test.threads).toBe(8); // warmup excluded
    expect(run.peak).toBe(run.test.threads);
    expect(run.active).toBe(0); expect(run.dispose).toHaveBeenCalledOnce();
  }
  expect(results.every(r => r.status === 'passed' && r.seconds! > 0 && r.mibPerSecond! > 0)).toBe(true);
  expect(progress).toHaveBeenLastCalledWith('已完成 6 / 6 项', results);
});

it.each(['wrong-digest', 'main-fallback', 'exception'] as const)('excludes %s results instead of reporting a misleading speed', async reason => {
  const disposals: ReturnType<typeof vi.fn>[] = [];
  const results = await runHashDiagnostics(async () => {
    const dispose = vi.fn(); disposals.push(dispose);
    return { dispose, async digest() {
      if (reason === 'exception') throw new Error('runtime failed');
      return { hex: reason === 'wrong-digest' ? '0'.repeat(64) : PROBE_HASH,
        computeMs: 1, backend: reason === 'main-fallback' ? 'main' : 'worker' };
    } };
  }, new AbortController().signal, () => {});
  expect(results).toHaveLength(6);
  expect(results.every(r => r.status === 'unavailable' && r.seconds === undefined && r.message)).toBe(true);
  expect(disposals.every(d => d.mock.calls.length === 1)).toBe(true);
});

it('does not start any service if already cancelled', async () => {
  const controller = new AbortController(); controller.abort(); const factory = vi.fn();
  await expect(runHashDiagnostics(factory, controller.signal, () => {})).rejects.toMatchObject({ name: 'AbortError' });
  expect(factory).not.toHaveBeenCalled();
});

it('settles all pending work on stop and never starts the next case', async () => {
  const controller = new AbortController();
  const pending: ((reason: Error) => void)[] = [];
  const dispose = vi.fn(() => { for (const reject of pending.splice(0)) reject(new Error('disposed')); });
  const factory = vi.fn(async (): Promise<HashService> => ({
    digest: () => new Promise((_resolve, reject) => pending.push(reject)), dispose,
  }));
  const result = runHashDiagnostics(factory, controller.signal, () => {}).catch(error => error);
  await Promise.resolve(); await Promise.resolve(); controller.abort();
  expect(await result).toMatchObject({ name: 'AbortError' });
  expect(factory).toHaveBeenCalledOnce(); expect(dispose).toHaveBeenCalled(); expect(pending).toHaveLength(0);
});

it('bounds each unresponsive case and disposes it before the next one', async () => {
  vi.useFakeTimers();
  let pending: ((reason: Error) => void)[] = [];
  const disposals: ReturnType<typeof vi.fn>[] = [];
  const result = runHashDiagnostics(async () => {
    expect(pending).toHaveLength(0);
    const dispose = vi.fn(() => { const previous = pending; pending = []; previous.forEach(reject => reject(new Error('disposed'))); });
    disposals.push(dispose);
    return { digest: () => new Promise((_resolve, reject) => pending.push(reject)), dispose };
  }, new AbortController().signal, () => {});
  await vi.runAllTimersAsync();
  expect((await result).every(row => row.status === 'unavailable' && row.message?.includes('超时'))).toBe(true);
  expect(disposals).toHaveLength(6); expect(pending).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});
