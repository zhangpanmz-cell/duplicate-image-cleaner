import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, stat, unlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import type { ISimilarGroup, SimilarityLevel } from '@/data/similarity';
import { applyDeletionResults, executeDeletion, fingerprint, makeDeletionPlan,
  type LiveDirectoryAccess, type LocalDirectoryHandle, type LocalFileHandle } from './file-deletion';

export async function fixture(level: SimilarityLevel = 'exact', count = 3) {
  const files = new Map<string, File>();
  const handles = new Map<string, LocalFileHandle>();
  const removed: string[] = [];
  const root: LocalDirectoryHandle = {
    kind: 'directory', name: 'photos',
    async *values() { yield* handles.values(); },
    resolve: vi.fn(async (handle) => files.has(handle.name) ? [handle.name] : null),
    getDirectoryHandle: vi.fn(async () => { throw new Error('No subdirectory'); }),
    getFileHandle: vi.fn(async (name) => {
      const handle = handles.get(name);
      if (!handle || !files.has(name)) throw new DOMException('Missing', 'NotFoundError');
      return handle;
    }),
    requestPermission: vi.fn(async () => 'granted' as const),
    queryPermission: vi.fn(async () => 'granted' as const),
    removeEntry: vi.fn(async (name, options) => {
      expect(options.recursive).toBe(false);
      if (!files.delete(name)) throw new DOMException('Missing', 'NotFoundError');
      removed.push(name);
    }),
  };
  const access: LiveDirectoryAccess = { root, targets: new Map() };
  const group: ISimilarGroup = { id: 'group', level, files: [], totalSize: 0, reclaimableSize: 0 };
  for (let i = 0; i < count; i++) {
    const name = `image-${i}.png`;
    const file = new File([level === 'exact' ? 'image data' : `image data ${i}`], name, { lastModified: 1234 });
    files.set(name, file);
    const handle: LocalFileHandle = {
      kind: 'file', name,
      getFile: vi.fn(async () => {
        const current = files.get(name);
        if (!current) throw new DOMException('Missing', 'NotFoundError');
        return current;
      }),
      isSameEntry: vi.fn(async (other) => other === handle),
    };
    handles.set(name, handle);
    const hash = await fingerprint(file);
    access.targets.set(String(i), { handle, path: [name], size: file.size, lastModified: file.lastModified, fingerprint: hash });
    group.files.push({ id: String(i), name, relativePath: `photos/${name}`, directory: 'photos',
      size: file.size, width: 10, height: 10, hash: level === 'exact' ? hash : '', phash: '', dhash: '',
      distance: 0, level, thumbnailUrl: `blob:${i}`, selected: i > 0, isKept: i === 0, source: 'scan' });
  }
  group.totalSize = group.files.reduce((sum, file) => sum + file.size, 0);
  group.reclaimableSize = group.files.slice(1).reduce((sum, file) => sum + file.size, 0);
  const plan = () => makeDeletionPlan([group], [group.id], group.files.filter((file) => file.selected).map((file) => file.id), access);
  return { files, handles, removed, root, access, group, plan };
}

describe('permanent deletion safety', () => {
  it('filesystem adapter removes only synthetic selected files from an isolated temporary directory', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dupcleaner-delete-test-'));
    try {
      const f = await fixture();
      for (const [name, file] of f.files) {
        await writeFile(join(temp, name), new Uint8Array(await file.arrayBuffer()));
        const handle = f.handles.get(name)!;
        handle.getFile = async () => {
          const data = await readFile(join(temp, name));
          return new File([data], name, { lastModified: (await stat(join(temp, name))).mtimeMs });
        };
        const entry = [...f.access.targets.values()].find((target) => target.handle === handle)!;
        entry.lastModified = (await handle.getFile()).lastModified;
      }
      await writeFile(join(temp, 'unrelated.txt'), 'must remain');
      f.root.removeEntry = async (name, options) => {
        expect(options.recursive).toBe(false);
        if (!f.files.has(name) || basename(name) !== name) throw new Error('Outside fixture');
        await unlink(join(temp, name)); f.files.delete(name);
      };
      const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
      expect(result.map((item) => item.status)).toEqual(['deleted', 'deleted']);
      expect((await readdir(temp)).sort()).toEqual(['image-0.png', 'unrelated.txt']);
      expect(await readFile(join(temp, 'image-0.png'), 'utf8')).toBe('image data');
    } finally {
      // Only the uniquely created fixture directory; never user images or a broad root.
      if (dirname(temp) === tmpdir().replace(/\/$/, '') && basename(temp).startsWith('dupcleaner-delete-test-')) {
        await rm(temp, { recursive: true });
      }
    }
  });
  it('deletes only explicitly selected files, keeping an exact original', async () => {
    const f = await fixture();
    const results = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(results.map((item) => item.status)).toEqual(['deleted', 'deleted']);
    expect([...f.files.keys()]).toEqual(['image-0.png']);
    expect(f.removed).toEqual(['image-1.png', 'image-2.png']);
  });
  it('never expands an empty scope or accepts a stale selection', async () => {
    const f = await fixture();
    expect(() => makeDeletionPlan([f.group], [], ['1'], f.access)).toThrow('勾选范围');
    expect(() => makeDeletionPlan([f.group], ['group'], ['1'], f.access)).toThrow('勾选范围');
    expect(() => makeDeletionPlan([f.group], ['group'], ['1', '1'], f.access)).toThrow('勾选范围');
    expect(f.root.removeEntry).not.toHaveBeenCalled();
  });
  it.each(['exact', 'high', 'suspected'] as const)('protects the final keeper for %s groups', async (level) => {
    const f = await fixture(level);
    f.group.files.forEach((file) => { file.selected = true; });
    expect(f.plan).toThrow('每组至少保留');
  });
  it.each(['mock', 'missing-handle', 'traversal', 'duplicate-path'] as const)('rejects %s targets', async (reason) => {
    const f = await fixture();
    if (reason === 'mock') f.group.files[1].source = 'mock';
    if (reason === 'missing-handle') f.access.targets.delete('1');
    if (reason === 'traversal') f.access.targets.get('1')!.path = ['..', 'image-1.png'];
    if (reason === 'duplicate-path') f.group.files[2] = { ...f.group.files[1], id: '2' };
    expect(f.plan).toThrow();
  });
  it('detects changed content even when size and modification time match', async () => {
    const f = await fixture();
    f.files.set('image-1.png', new File(['other data'], 'image-1.png', { lastModified: 1234 }));
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result[0].status).toBe('failed');
    expect(result[0].message).toContain('内容');
    expect(f.removed).toEqual(['image-2.png']);
  });
  it('stops the group if the keeper is missing or changed', async () => {
    const f = await fixture();
    f.files.delete('image-0.png');
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result.every((item) => item.status === 'failed')).toBe(true);
    expect(f.root.removeEntry).not.toHaveBeenCalled();
  });
  it('rechecks the keeper between deletions', async () => {
    const f = await fixture();
    const originalRemove = f.root.removeEntry;
    f.root.removeEntry = async (name, options) => { await originalRemove(name, options); f.files.delete('image-0.png'); };
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result.map((item) => item.status)).toEqual(['deleted', 'failed']);
    expect(f.removed).toEqual(['image-1.png']);
  });
  it('rejects a replaced file at the same path', async () => {
    const f = await fixture();
    f.handles.get('image-1.png')!.isSameEntry = async () => false;
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result[0].message).toContain('替换');
    expect(f.removed).toEqual(['image-2.png']);
  });
  it('never deletes a file moved outside the original directory', async () => {
    const f = await fixture();
    f.root.resolve = async () => ['different-directory', 'file.png'];
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result.every((item) => item.status === 'failed')).toBe(true);
    expect(f.root.removeEntry).not.toHaveBeenCalled();
  });
  it('does not count missing files as successful removals', async () => {
    const f = await fixture();
    f.files.delete('image-1.png');
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result.map((item) => item.status)).toEqual(['failed', 'deleted']);
  });
  it('checks directory write permission and stops on revocation', async () => {
    const f = await fixture();
    f.root.queryPermission = async () => 'denied';
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result.map((item) => item.status)).toEqual(['failed', 'cancelled']);
    expect(f.root.removeEntry).not.toHaveBeenCalled();
  });
  it('records a removeEntry failure without hiding the file', async () => {
    const f = await fixture();
    vi.mocked(f.root.removeEntry).mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result.map((item) => item.status)).toEqual(['failed', 'cancelled']);
    expect(applyDeletionResults([f.group], result).remainingGroups).toEqual([f.group]);
  });
  it('cancellation never undoes success, and skips every subsequent file', async () => {
    const f = await fixture();
    const token = { cancelled: false };
    const result = await executeDeletion(f.access, f.plan(), token, (progress) => {
      if (progress.completed === 1) token.cancelled = true;
    });
    expect(result.map((item) => item.status)).toEqual(['deleted', 'cancelled']);
    const hidden = { ...f.group, id: 'hidden', files: f.group.files.map((file) => ({ ...file, id: `hidden-${file.id}` })) };
    const applied = applyDeletionResults([f.group, hidden], result);
    expect(applied.cleanedGroups).toBe(1);
    expect(applied.remainingGroups[0].files.map((file) => file.id)).toEqual(['0', '2']);
    expect(applied.remainingGroups[0].files[1].selected).toBe(true);
    expect(applied.remainingGroups[1]).toBe(hidden);
  });
  it('allows manually selected similar files only while preserving a verified keeper', async () => {
    const f = await fixture('suspected');
    const result = await executeDeletion(f.access, f.plan(), { cancelled: false });
    expect(result.every((item) => item.status === 'deleted')).toBe(true);
    expect(f.files.has('image-0.png')).toBe(true);
  });
  it('cancellation during revalidation prevents even the first removal', async () => {
    const f = await fixture();
    const token = { cancelled: false };
    const oldGet = f.handles.get('image-1.png')!.getFile;
    f.handles.get('image-1.png')!.getFile = async () => { token.cancelled = true; return oldGet(); };
    const result = await executeDeletion(f.access, f.plan(), token);
    expect(result.every((item) => item.status === 'cancelled')).toBe(true);
    expect(f.root.removeEntry).not.toHaveBeenCalled();
  });
});
