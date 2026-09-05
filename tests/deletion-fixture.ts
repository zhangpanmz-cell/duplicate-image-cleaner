import type { ISimilarGroup, SimilarityLevel } from '../src/data/similarity';
import type { LiveDirectoryAccess, LocalDirectoryHandle, LocalFileHandle } from '../src/lib/file-deletion';

/** In-memory File System Access adapter. removeEntry ONLY removes a Map entry. */
export async function deletionFixture({
  groupCount = 1, selectedCount = 2, retainedCount = 1, bytes = 1024,
  delayMs = 0, depth = 0, level = 'exact' as SimilarityLevel,
} = {}) {
  const payload = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', payload);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  // Blob is immutable; sharing backing bytes avoids allocating GBs of identical
  // fixture payloads. Each verification still reads and hashes the entire File.
  const blob = new Blob([payload]);
  const files = new Map<string, File>();
  const handles = new Map<string, LocalFileHandle>();
  const reads = new Map<string, number>();
  const removed: string[] = [];
  const folders = Array.from({ length: depth }, (_, index) => `folder-${index}`);
  const pause = async () => { if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs)); };
  const get = (name: string) => {
    const file = files.get(name);
    if (!file) throw new DOMException('Missing synthetic file', 'NotFoundError');
    return file;
  };
  const root: LocalDirectoryHandle = {
    kind: 'directory', name: 'synthetic',
    async *values() { yield* handles.values(); },
    async resolve(handle) { await pause(); return files.has(handle.name) ? [...folders, handle.name] : null; },
    async getDirectoryHandle() { await pause(); return root; },
    async getFileHandle(name) { await pause(); get(name); return handles.get(name)!; },
    async requestPermission() { return 'granted'; },
    async queryPermission() { await pause(); return 'granted'; },
    async removeEntry(name, options) {
      await pause();
      if (options.recursive !== false) throw new Error('Recursive removal forbidden');
      get(name); files.delete(name); removed.push(name);
    },
  };
  const access: LiveDirectoryAccess = { root, targets: new Map() };
  const groups: ISimilarGroup[] = [];
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const group: ISimilarGroup = { id: `group-${groupIndex}`, level, files: [],
      totalSize: (selectedCount + retainedCount) * bytes, reclaimableSize: selectedCount * bytes };
    for (let index = 0; index < selectedCount + retainedCount; index += 1) {
      const name = `group-${groupIndex}-file-${index}.png`;
      const file = new File([blob], name, { lastModified: 1234 });
      files.set(name, file);
      const handle: LocalFileHandle = {
        kind: 'file', name,
        async getFile() { await pause(); reads.set(name, (reads.get(name) ?? 0) + 1); return get(name); },
        async isSameEntry(other) { await pause(); return other === handle; },
      };
      handles.set(name, handle);
      access.targets.set(name, { handle, path: [...folders, name], size: bytes, lastModified: 1234, fingerprint: hash });
      group.files.push({ id: name, name, relativePath: ['synthetic', ...folders, name].join('/'),
        directory: ['synthetic', ...folders].join('/'), size: bytes, width: 10, height: 10,
        hash: level === 'exact' ? hash : '', phash: '', dhash: '', distance: 0, level,
        thumbnailUrl: '', selected: index >= retainedCount, isKept: index < retainedCount, source: 'scan' });
    }
    groups.push(group);
  }
  return { access, root, groups, files, handles, reads, removed };
}
