import { describe, expect, it } from 'vitest';
import { equalBytes } from './exact-bytes';
import { deletionFixture } from '../../tests/deletion-fixture';
import { executeDeletion, makeDeletionPlan, type DeletionMetrics, type DeletionOptions } from './file-deletion';

type Fixture = Awaited<ReturnType<typeof deletionFixture>>;
const plan = (f: Fixture) => makeDeletionPlan(f.groups, f.groups.map(g => g.id),
  f.groups.flatMap(g => g.files.filter(f => f.selected).map(f => f.id)), f.access);
const change = (f: Fixture, name: string, offset: number) => {
  const bytes = new Uint8Array(f.access.targets.get(name)!.size); bytes[offset] = 1;
  f.files.set(name, new File([bytes], name, { lastModified: 1234 }));
};
async function run(f: Fixture, options: DeletionOptions = {}) {
  let metrics: DeletionMetrics | undefined;
  const results = await executeDeletion(f.access, plan(f), { cancelled: false }, undefined,
    { ...options, onMetrics: m => { metrics = m; } });
  return { results, metrics: metrics! };
}

describe('complete byte equality', () => {
  it('checks every position and the 1–3 trailing bytes, including empty and unequal sizes', () => {
    for (let length = 0; length <= 129; length++) {
      const a = Uint8Array.from({ length }, (_, i) => (i * 31 + length) & 255);
      expect(equalBytes(a.buffer, a.slice().buffer)).toBe(true);
      expect(equalBytes(a.buffer, new ArrayBuffer(length + 1))).toBe(false);
      for (let offset = 0; offset < length; offset++) {
        const b = a.slice(); b[offset] ^= 1;
        expect(equalBytes(a.buffer, b.buffer), `length ${length}, offset ${offset}`).toBe(false);
      }
    }
  });
  it.each([0, 1024 * 1024, 2 * 1024 * 1024 + 2])('detects a changed byte at offset %i in a large file', offset => {
    const a = new ArrayBuffer(2 * 1024 * 1024 + 3), b = a.slice(0);
    new Uint8Array(b)[offset] = 1; expect(equalBytes(a, b)).toBe(false);
  });
});

describe('fresh keeper hash plus exact-copy full byte comparison', () => {
  it.each(['exact', 'high', 'suspected'] as const)('reduces SHA work only in %s groups, with every keeper still re-read', async level => {
    const f = await deletionFixture({ groupCount: 3, selectedCount: 4, retainedCount: 2, bytes: 1027, level });
    const { results, metrics } = await run(f);
    expect(results.every(r => r.status === 'deleted')).toBe(true);
    expect(metrics.verifiedFiles).toBe(36); expect(metrics.verifiedBytes).toBe(36 * 1027);
    expect(metrics.byteComparedFiles).toBe(level === 'exact' ? 12 : 0);
    expect(metrics.mainHashFiles).toBe(level === 'exact' ? 24 : 36);
    for (const keeper of f.groups.flatMap(g => g.files.filter(f => !f.selected))) expect(f.reads.get(keeper.id)).toBe(4);
    expect(f.files.size).toBe(6);
  });
  it.each([0, 1026])('skips only a copy changed at byte %i despite unchanged metadata', async offset => {
    const f = await deletionFixture({ bytes: 1027 });
    change(f, f.groups[0].files[1].id, offset);
    const { results } = await run(f);
    expect(results.map(r => r.status)).toEqual(['failed', 'deleted']);
    expect(f.removed).toEqual([f.groups[0].files[2].id]);
  });
  it('rejects identically modified keeper and copies: byte equality alone cannot authorize deletion', async () => {
    const f = await deletionFixture({ bytes: 1027 });
    for (const file of f.groups[0].files) change(f, file.id, 1026);
    const { results, metrics } = await run(f);
    expect(results.every(r => r.status === 'failed' && r.message.includes('保留项核验失败'))).toBe(true);
    expect(metrics.deleteCalls).toBe(0); expect(f.files.size).toBe(3);
  });
  it.each([0, 1])('rechecks keeper %i after every removal, including keepers outside the pair', async keeperIndex => {
    const f = await deletionFixture({ retainedCount: 2, selectedCount: 3, bytes: 1027 });
    const remove = f.root.removeEntry;
    f.root.removeEntry = async (name, options) => { await remove(name, options); change(f, f.groups[0].files[keeperIndex].id, 1026); };
    const { results } = await run(f);
    expect(results.map(r => r.status)).toEqual(['deleted', 'failed', 'failed']);
    expect(results[1].message).toContain('保留项核验失败'); expect(f.removed).toHaveLength(1);
  });
  it('rejects a copy with a different recorded fingerprint even if its current bytes match', async () => {
    const f = await deletionFixture(); f.access.targets.get(f.groups[0].files[1].id)!.fingerprint = 'a'.repeat(64);
    const { results } = await run(f); expect(results[0].status).toBe('failed');
    expect(f.removed).not.toContain(f.groups[0].files[1].id);
  });
  it.each(['moved', 'identity', 'mtime', 'missing', 'permission'] as const)('still fails closed for %s changes inside a pair', async reason => {
    const f = await deletionFixture({ selectedCount: 1 });
    const copy = f.groups[0].files[1], handle = f.handles.get(copy.id)!;
    if (reason === 'moved') f.root.resolve = async () => ['elsewhere.png'];
    if (reason === 'identity') handle.isSameEntry = async () => false;
    if (reason === 'mtime') f.files.set(copy.id, new File([new Uint8Array(1024)], copy.name, { lastModified: 9999 }));
    if (reason === 'missing') f.files.delete(copy.id);
    if (reason === 'permission') handle.getFile = async () => { throw new DOMException('denied', 'NotAllowedError'); };
    const { results } = await run(f); expect(results[0].status).not.toBe('deleted'); expect(f.removed).toHaveLength(0);
  });
  it('counts BOTH buffers against the shared input budget and falls back for oversized pairs', async () => {
    for (const budget of [1024, 2048, 4096]) {
      const f = await deletionFixture({ groupCount: 6, selectedCount: 2, delayMs: 1 });
      const { metrics } = await run(f, { maxInputBytes: budget });
      expect(metrics.peakInputBytes).toBeLessThanOrEqual(budget);
      expect(metrics.peakChecks).toBeLessThanOrEqual(4);
      expect(metrics.byteComparedFiles).toBe(budget >= 2048 ? 12 : 0);
      expect(f.removed).toHaveLength(12);
    }
  });
  it('keeps a full-hash baseline for controlled synthetic comparisons', async () => {
    const f = await deletionFixture(); const { metrics } = await run(f, { exactVerification: 'hash' });
    expect(metrics.mainHashFiles).toBe(4); expect(metrics.byteComparedFiles).toBe(0);
  });
  it('waits for the other paired read to settle when the keeper read fails', async () => {
    const f = await deletionFixture({ selectedCount: 1 });
    const [keeper, copy] = f.groups[0].files;
    const a = f.files.get(keeper.id)!, b = f.files.get(copy.id)!;
    let finished = false;
    a.arrayBuffer = async () => { throw new DOMException('Changed during read', 'NotReadableError'); };
    b.arrayBuffer = async () => { await new Promise(resolve => setTimeout(resolve, 20)); finished = true; return new ArrayBuffer(1024); };
    const { results } = await run(f);
    expect(finished).toBe(true); expect(results[0].message).toContain('保留项核验失败'); expect(f.removed).toHaveLength(0);
  });
  it('does not submit a pair for computation after cancellation during a file read', async () => {
    const f = await deletionFixture({ selectedCount: 2 }); const token = { cancelled: false };
    const keeper = f.files.get(f.groups[0].files[0].id)!;
    keeper.arrayBuffer = async () => { token.cancelled = true; return new ArrayBuffer(1024); };
    let metrics: DeletionMetrics | undefined;
    const results = await executeDeletion(f.access, plan(f), token, undefined, { onMetrics: m => { metrics = m; } });
    expect(results.every(r => r.status === 'cancelled')).toBe(true);
    expect(metrics?.mainHashFiles).toBe(0); expect(f.removed).toHaveLength(0);
  });
});
