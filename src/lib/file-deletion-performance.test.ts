import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { deletionFixture } from '../../tests/deletion-fixture';
import { executeDeletion, makeDeletionPlan, type DeletionMetrics, type DeletionProgress } from './file-deletion';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Fixture = Awaited<ReturnType<typeof deletionFixture>>;
const plan = (f: Fixture) => makeDeletionPlan(f.groups, f.groups.map((g) => g.id),
  f.groups.flatMap((g) => g.files.filter((file) => file.selected).map((file) => file.id)), f.access);

describe('bounded deletion throughput without skipping safety checks', () => {
  it('removes only synthetic selected files across groups in an isolated filesystem directory', async () => {
    const f = await deletionFixture({ groupCount: 6, selectedCount: 3, retainedCount: 2 });
    const temp = await mkdtemp(join(tmpdir(), 'dupcleaner-parallel-delete-test-'));
    try {
      for (const [name, file] of f.files) {
        await writeFile(join(temp, name), new Uint8Array(await file.arrayBuffer()));
        const target = f.access.targets.get(name)!;
        target.handle.getFile = async () => {
          const info = await stat(join(temp, name));
          return new File([await readFile(join(temp, name))], name, { lastModified: info.mtimeMs });
        };
        target.lastModified = (await target.handle.getFile()).lastModified;
      }
      await writeFile(join(temp, 'unrelated.txt'), 'unchanged');
      const originalRemove = f.root.removeEntry;
      f.root.removeEntry = async (name, options) => {
        if (basename(name) !== name || !f.files.has(name) || options.recursive !== false) throw new Error('Outside fixture');
        await unlink(join(temp, name)); await originalRemove(name, options);
      };
      const results = await executeDeletion(f.access, plan(f), { cancelled: false });
      expect(results.filter((r) => r.status === 'deleted')).toHaveLength(18);
      const keepers = f.groups.flatMap((g) => g.files.filter((file) => !file.selected).map((file) => file.name));
      expect((await readdir(temp)).sort()).toEqual([...keepers, 'unrelated.txt'].sort());
      expect(await readFile(join(temp, 'unrelated.txt'), 'utf8')).toBe('unchanged');
    } finally {
      if (dirname(temp) === tmpdir().replace(/\/$/, '') && basename(temp).startsWith('dupcleaner-parallel-delete-test-')) {
        await rm(temp, { recursive: true });
      }
    }
  });

  it('overlaps independent groups, caps removal concurrency, and keeps manifest order', async () => {
    const f = await deletionFixture({ groupCount: 8, selectedCount: 1 });
    const originalRemove = f.root.removeEntry;
    let active = 0, peak = 0;
    f.root.removeEntry = async (name, options) => {
      active += 1; peak = Math.max(peak, active);
      await pause(name.startsWith('group-0') ? 30 : 5);
      await originalRemove(name, options); active -= 1;
    };
    const progress: DeletionProgress[] = [];
    const p = plan(f);
    const results = await executeDeletion(f.access, p, { cancelled: false }, (value) => progress.push(value));
    expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(4);
    expect(active).toBe(0);
    expect(results.map((r) => r.id)).toEqual(p.files.map((file) => file.id));
    expect(results.every((r) => r.status === 'deleted')).toBe(true);
    expect(progress.map((p) => p.completed)).toEqual(progress.map((p) => p.completed).sort((a, b) => a - b));
    expect(progress.at(-1)).toMatchObject({ completed: 8, total: 8, phase: 'finished', activeChecks: 0, activeDeletes: 0 });
  });

  it.each(['exact', 'high', 'suspected'] as const)('rechecks ALL keepers for every removal in %s groups', async (level) => {
    const f = await deletionFixture({ selectedCount: 3, retainedCount: 3, level });
    let metrics: DeletionMetrics | undefined;
    const results = await executeDeletion(f.access, plan(f), { cancelled: false }, undefined, { onMetrics: (m) => { metrics = m; } });
    expect(results.every((r) => r.status === 'deleted')).toBe(true);
    for (const keeper of f.groups[0].files.filter((file) => !file.selected)) expect(f.reads.get(keeper.name)).toBe(3);
    expect(metrics).toMatchObject({ verifiedFiles: 12, verifiedBytes: 12 * 1024, deleteCalls: 3, peakDeletes: 1 });
    expect(JSON.stringify(metrics)).not.toContain('group-');
  });

  it('detects a keeper changed between deletions even with unchanged size and mtime', async () => {
    const f = await deletionFixture({ retainedCount: 2 });
    const remove = f.root.removeEntry;
    const keeper = f.groups[0].files[1];
    f.root.removeEntry = async (name, options) => {
      await remove(name, options);
      f.files.set(keeper.name, new File([new Uint8Array(1024).fill(1)], keeper.name, { lastModified: 1234 }));
    };
    const results = await executeDeletion(f.access, plan(f), { cancelled: false });
    expect(results.map((r) => r.status)).toEqual(['deleted', 'failed']);
    expect(results[1].message).toContain('保留项核验失败');
    expect(f.removed).toHaveLength(1);
  });

  it('stops all groups before removal when a parallel permission check is denied', async () => {
    const f = await deletionFixture({ groupCount: 8, selectedCount: 1, delayMs: 1 });
    let calls = 0;
    f.root.queryPermission = async () => ++calls === 1 ? 'granted' : 'denied';
    const results = await executeDeletion(f.access, plan(f), { cancelled: false });
    expect(f.removed).toHaveLength(0);
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.status !== 'deleted')).toBe(true);
  });

  it('cancels queued work and waits for already submitted removals before returning', async () => {
    const f = await deletionFixture({ groupCount: 12, selectedCount: 2 });
    const token = { cancelled: false };
    const remove = f.root.removeEntry;
    let submitted = 0, finished = 0;
    f.root.removeEntry = async (name, options) => {
      submitted += 1; await pause(15); token.cancelled = true;
      await remove(name, options); finished += 1;
    };
    const results = await executeDeletion(f.access, plan(f), token);
    expect(submitted).toBeLessThanOrEqual(4);
    expect(finished).toBe(submitted);
    expect(results.filter((r) => r.status === 'deleted')).toHaveLength(submitted);
    expect(results.filter((r) => r.status === 'cancelled')).toHaveLength(24 - submitted);
    await pause(20); expect(finished).toBe(submitted);
  });

  it('propagates write revocation across groups without new removals or orphaned work', async () => {
    const f = await deletionFixture({ groupCount: 12, selectedCount: 2 });
    let submitted = 0, finished = 0;
    const remove = f.root.removeEntry;
    f.root.removeEntry = async (name, options) => {
      submitted += 1;
      if (name.startsWith('group-0')) { await pause(2); throw new DOMException('Revoked', 'NotAllowedError'); }
      await pause(15); await remove(name, options); finished += 1;
    };
    const results = await executeDeletion(f.access, plan(f), { cancelled: false });
    expect(submitted).toBeLessThanOrEqual(4);
    expect(results[0].status).toBe('failed');
    expect(results.some((r) => r.status === 'cancelled')).toBe(true);
    const after = { submitted, finished }; await pause(20);
    expect({ submitted, finished }).toEqual(after);
  });

  it.each([{ bytes: 1024, budget: 2048, peak: 2 }, { bytes: 4096, budget: 1024, peak: 1 }])(
    'bounds file inputs and runs oversized files alone: %j', async ({ bytes, budget, peak }) => {
      const f = await deletionFixture({ groupCount: 6, selectedCount: 1, bytes, delayMs: 1 });
      let metrics: DeletionMetrics | undefined;
      await executeDeletion(f.access, plan(f), { cancelled: false }, undefined,
        { maxInputBytes: budget, onMetrics: (value) => { metrics = value; } });
      expect(metrics?.peakChecks).toBeLessThanOrEqual(peak);
      expect(metrics?.peakInputBytes).toBeLessThanOrEqual(Math.max(bytes, budget));
      expect(metrics?.deleteCalls).toBe(6);
    },
  );

  it('settles sibling checks when a keeper fails instead of leaving background checks running', async () => {
    const f = await deletionFixture({ selectedCount: 1 });
    const keeper = f.groups[0].files[0];
    const target = f.groups[0].files[1];
    f.handles.get(keeper.name)!.getFile = async () => { throw new Error('Keeper changed'); };
    let checked = false;
    const getFile = f.handles.get(target.name)!.getFile;
    f.handles.get(target.name)!.getFile = async () => { await pause(20); checked = true; return getFile(); };
    const results = await executeDeletion(f.access, plan(f), { cancelled: false });
    expect(checked).toBe(true);
    expect(results[0].status).toBe('failed'); expect(f.removed).toHaveLength(0);
  });

  it('stops workers and waits for submitted operations if a progress observer throws', async () => {
    const f = await deletionFixture({ groupCount: 10, selectedCount: 2 });
    const remove = f.root.removeEntry;
    let pending = 0;
    f.root.removeEntry = async (name, options) => {
      pending += 1;
      try { await pause(10); await remove(name, options); } finally { pending -= 1; }
    };
    await expect(executeDeletion(f.access, plan(f), { cancelled: false }, (progress) => {
      if (progress.completed > 0) throw new Error('Unexpected UI error');
    })).rejects.toThrow('Unexpected UI error');
    expect(pending).toBe(0);
    const count = f.removed.length;
    await pause(20); expect(f.removed).toHaveLength(count);
  });
});
