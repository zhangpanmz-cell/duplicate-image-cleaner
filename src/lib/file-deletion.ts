import type { ISimilarFileEntry, ISimilarGroup } from '@/data/similarity';

/** Browser File System Access contracts. Handles stay in this tab, never in the cache. */
export interface LocalFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  isSameEntry(other: LocalFileHandle): Promise<boolean>;
}
export interface LocalDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<LocalDirectoryHandle | LocalFileHandle>;
  resolve(handle: LocalFileHandle): Promise<string[] | null>;
  getDirectoryHandle(name: string): Promise<LocalDirectoryHandle>;
  getFileHandle(name: string): Promise<LocalFileHandle>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  removeEntry(name: string, options: { recursive: false }): Promise<void>;
}
export interface LiveFileTarget {
  handle: LocalFileHandle;
  path: string[];
  size: number;
  lastModified: number;
  fingerprint: string;
}
export interface LiveDirectoryAccess {
  root: LocalDirectoryHandle;
  targets: Map<string, LiveFileTarget>;
}
export interface DeletionItemResult {
  id: string;
  path: string;
  size: number;
  status: 'deleted' | 'failed' | 'cancelled';
  message: string;
}
export interface DeletionProgress { completed: number; total: number; currentFile: string }
export interface DeletionPlan {
  groups: { retained: ISimilarFileEntry[]; selected: ISimilarFileEntry[]; level: ISimilarGroup['level'] }[];
  files: ISimilarFileEntry[];
}

export async function fingerprint(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validPart(part: string): boolean {
  return part.length > 0 && part !== '.' && part !== '..' && !/[\/\\\0]/.test(part);
}

/** Only an explicit selection from this live scan can become a deletion plan. */
export function makeDeletionPlan(
  groups: ISimilarGroup[], scopeIds: string[], selectedIds: string[], access: LiveDirectoryAccess,
): DeletionPlan {
  const scope = new Set(scopeIds);
  const scoped = groups.filter((group) => scope.has(group.id));
  const files = scoped.flatMap((group) => group.files.filter((file) => file.selected));
  const expected = new Set(selectedIds);
  if (!files.length || expected.size !== selectedIds.length || files.length !== expected.size
    || files.some((file) => !expected.has(file.id))) {
    throw new Error('勾选范围已变化，请关闭弹窗后重新确认。');
  }
  const paths = new Set<string>();
  const plan: DeletionPlan = { groups: [], files };
  for (const group of scoped) {
    const selected = group.files.filter((file) => file.selected);
    if (!selected.length) continue;
    const retained = group.files.filter((file) => !file.selected);
    if (!retained.length) throw new Error('每组至少保留一份图片，不能整组删除。');
    for (const file of group.files) {
      const target = access.targets.get(file.id);
      if (file.source !== 'scan' || !target || target.size !== file.size
        || !target.path.length || !target.path.every(validPart)
        || target.path.at(-1) !== file.name || target.handle.name !== file.name
        || `${access.root.name}/${target.path.join('/')}` !== file.relativePath
        || !/^[a-f0-9]{64}$/.test(target.fingerprint)) {
        throw new Error('当前记录没有有效的原文件授权，请从首页选择文件夹重新扫描。');
      }
      if (paths.has(file.relativePath)) throw new Error('文件路径重复，请重新扫描。');
      paths.add(file.relativePath);
    }
    plan.groups.push({ selected, retained, level: group.level });
  }
  return plan;
}

async function verifiedParent(access: LiveDirectoryAccess, file: ISimilarFileEntry) {
  const target = access.targets.get(file.id);
  if (!target) throw new Error('原文件授权失效，请重新扫描。');
  const actualPath = await access.root.resolve(target.handle);
  if (!actualPath || actualPath.join('/') !== target.path.join('/')) {
    throw new Error('文件已移动或不在原扫描目录内，未删除。');
  }
  let parent = access.root;
  for (const part of target.path.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
  // No create flags, no path-based fallback, no directory deletion.
  const current = await parent.getFileHandle(file.name);
  if (!await current.isSameEntry(target.handle)) throw new Error('原路径已被其他文件替换，未删除。');
  const fresh = await current.getFile();
  if (fresh.size !== target.size || fresh.lastModified !== target.lastModified
    || await fingerprint(fresh) !== target.fingerprint) {
    throw new Error('文件内容或修改时间已变化，未删除；请重新扫描。');
  }
  return parent;
}

function failureMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '没有目录写入权限，文件未删除。';
  if (name === 'NotFoundError') return '文件或保留项已不存在，请重新扫描。';
  if (name === 'NotReadableError') return '文件正在使用或已变化，文件未删除。';
  return error instanceof Error ? error.message : '删除失败，文件未删除。';
}

/** Caller obtains permission on a user gesture and journals the pending operation first.
 * Each retained file and target is re-read immediately before removal. The web API cannot
 * atomically compare-and-remove against external edits: UI asks users to close other editors.
 */
export async function executeDeletion(
  access: LiveDirectoryAccess, plan: DeletionPlan, token: { cancelled: boolean },
  onProgress: (progress: DeletionProgress) => void = () => undefined,
): Promise<DeletionItemResult[]> {
  const results: DeletionItemResult[] = [];
  let stop = false;
  for (const group of plan.groups) {
    let groupError: string | null = null;
    for (const file of group.selected) {
      onProgress({ completed: results.length, total: plan.files.length, currentFile: file.relativePath });
      const result: DeletionItemResult = {
        id: file.id, path: file.relativePath, size: file.size, status: 'failed', message: '',
      };
      try {
        if (token.cancelled || stop) {
          result.status = 'cancelled';
          result.message = '操作已停止，此文件未删除。';
        } else if (groupError) {
          result.message = groupError;
        } else {
          if (await access.root.queryPermission({ mode: 'readwrite' }) !== 'granted') {
            stop = true;
            throw new Error('目录写入权限已撤销，已停止删除。');
          }
          try {
            for (const retained of group.retained) await verifiedParent(access, retained);
            if (group.level === 'exact') {
              const keeperHash = access.targets.get(group.retained[0].id)?.fingerprint;
              if (access.targets.get(file.id)?.fingerprint !== keeperHash) {
                throw new Error('副本与保留项不再完全一致，未删除。');
              }
            }
          } catch (error) {
            groupError = `保留项核验失败：${failureMessage(error)}`;
            throw new Error(groupError);
          }
          const parent = await verifiedParent(access, file);
          if (token.cancelled) {
            result.status = 'cancelled';
            result.message = '操作已停止，此文件未删除。';
          } else {
            await parent.removeEntry(file.name, { recursive: false });
            result.status = 'deleted';
            result.message = '已删除';
          }
        }
      } catch (error) {
        result.message = failureMessage(error);
        if (error instanceof Error && ['NotAllowedError', 'SecurityError'].includes(error.name)) stop = true;
      }
      results.push(result);
      onProgress({ completed: results.length, total: plan.files.length, currentFile: file.relativePath });
    }
  }
  return results;
}

/** Failed/untouched selections stay visible; only successful removals count as deleted. */
export function applyDeletionResults(groups: ISimilarGroup[], results: DeletionItemResult[]) {
  const deleted = new Set(results.filter((item) => item.status === 'deleted').map((item) => item.id));
  const revokeUrls: string[] = [];
  let cleanedGroups = 0;
  const remainingGroups = groups.flatMap((group) => {
    if (!group.files.some((file) => deleted.has(file.id))) return [group];
    cleanedGroups += 1;
    const files = group.files.filter((file) => !deleted.has(file.id));
    for (const file of group.files) {
      if (deleted.has(file.id) || files.length < 2) revokeUrls.push(file.thumbnailUrl);
    }
    if (files.length < 2) return [];
    return [{ ...group, files, totalSize: files.reduce((sum, file) => sum + file.size, 0),
      reclaimableSize: files.reduce((sum, file) => sum + (file.selected ? file.size : 0), 0) }];
  });
  return { remainingGroups, cleanedGroups, revokeUrls };
}
