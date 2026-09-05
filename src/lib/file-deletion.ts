import type { ISimilarFileEntry, ISimilarGroup } from '@/data/similarity';
import { nativeHashService, type HashService } from './sha256-pool.ts';

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
export interface DeletionProgress {
  completed: number; total: number; currentFile: string;
  phase?: 'authorizing' | 'working' | 'finished';
  activeChecks?: number; activeDeletes?: number; verifiedBytes?: number; elapsedMs?: number;
}
/** Aggregate timings only: no paths, pictures, persistence or network reporting. */
export interface DeletionMetrics {
  elapsedMs: number; authorizationMs: number; permissionMs: number;
  metadataMs: number; readMs: number; hashMs: number; deleteMs: number;
  verifiedFiles: number; verifiedBytes: number; deleteCalls: number;
  peakChecks: number; peakDeletes: number; peakInputBytes: number;
  workerHashFiles?: number; mainHashFiles?: number; hashComputeMs?: number;
  byteComparedFiles?: number; byteCompareMs?: number;
}
export interface DeletionOptions {
  groupConcurrency?: number;
  verificationConcurrency?: number;
  maxInputBytes?: number;
  /** Diagnostic baseline only; both modes always verify the complete fresh file. */
  hashExecution?: 'auto' | 'main';
  /** Synthetic comparison baseline; not a user-facing safety bypass. */
  exactVerification?: 'bytes' | 'hash';
  onMetrics?: (metrics: DeletionMetrics) => void;
}
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

/** FIFO bound on both open verification jobs and their input bytes. An oversized
 * file runs alone; this bounds our inputs, not the browser's total heap/copies. */
function verificationLimiter(concurrency: number, budget: number) {
  let active = 0;
  let bytes = 0;
  const queue: { weight: number; ready: () => void }[] = [];
  function drain() {
    while (queue.length && active < concurrency) {
      const next = queue[0];
      if (active && bytes + next.weight > budget) break;
      queue.shift(); active += 1; bytes += next.weight; next.ready();
    }
  }
  return async <T>(weight: number, work: () => Promise<T>): Promise<T> => {
    await new Promise<void>((ready) => { queue.push({ weight, ready }); drain(); });
    try { return await work(); } finally { active -= 1; bytes -= weight; drain(); }
  };
}

type TimedStage = 'permissionMs' | 'metadataMs' | 'readMs' | 'hashMs' | 'deleteMs';
type Measure = <T>(stage: TimedStage, work: () => Promise<T>) => Promise<T>;
class DeletionStopped extends Error {}
class KeeperVerificationFailed extends Error {}

async function freshTarget(
  access: LiveDirectoryAccess, file: ISimilarFileEntry, measure: Measure,
  checkRunning: () => void,
) {
  const target = access.targets.get(file.id);
  if (!target) throw new Error('原文件授权失效，请重新扫描。');
  const { parent, fresh } = await measure('metadataMs', async () => {
    const actualPath = await access.root.resolve(target.handle);
    checkRunning();
    if (!actualPath || actualPath.join('/') !== target.path.join('/')) {
      throw new Error('文件已移动或不在原扫描目录内，未删除。');
    }
    let parent = access.root;
    for (const part of target.path.slice(0, -1)) {
      parent = await parent.getDirectoryHandle(part); checkRunning();
    }
    // Always resolve the original path and identity afresh. No cached parents.
    const current = await parent.getFileHandle(file.name);
    checkRunning();
    if (!await current.isSameEntry(target.handle)) throw new Error('原路径已被其他文件替换，未删除。');
    checkRunning();
    const fresh = await current.getFile();
    checkRunning();
    if (fresh.size !== target.size || fresh.lastModified !== target.lastModified) {
      throw new Error('文件内容或修改时间已变化，未删除；请重新扫描。');
    }
    return { parent, fresh };
  });
  return { parent, fresh, target };
}

async function verifiedParent(
  access: LiveDirectoryAccess, file: ISimilarFileEntry, measure: Measure,
  checkRunning: () => void, metrics: DeletionMetrics, hasher: HashService,
) {
  const { parent, fresh, target } = await freshTarget(access, file, measure, checkRunning);
  const buffer = await measure('readMs', () => fresh.arrayBuffer());
  checkRunning();
  const digest = await measure('hashMs', () => hasher.digest(buffer));
  checkRunning();
  metrics.hashComputeMs! += digest.computeMs;
  if (digest.backend === 'worker') metrics.workerHashFiles! += 1;
  else metrics.mainHashFiles! += 1;
  if (digest.hex !== target.fingerprint) {
    throw new Error('文件内容或修改时间已变化，未删除；请重新扫描。');
  }
  metrics.verifiedFiles += 1;
  metrics.verifiedBytes += fresh.size;
  return parent;
}

function failureMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '没有目录写入权限，文件未删除。';
  if (name === 'NotFoundError') return '文件或保留项已不存在，请重新扫描。';
  if (name === 'NotReadableError') return '文件正在使用或已变化，文件未删除。';
  return error instanceof Error ? error.message : '删除失败，文件未删除。';
}

/** Independent, disjoint groups can overlap. Within a group every removal waits for
 * fresh FULL verification of ALL keepers and its target, after the previous removal.
 * No hash/metadata cache and no ahead-of-time batch approval. Web APIs still cannot
 * atomically compare-and-remove against external edits; users must close other editors.
 */
export async function executeDeletion(
  access: LiveDirectoryAccess, plan: DeletionPlan, token: { cancelled: boolean },
  onProgress: (progress: DeletionProgress) => void = () => undefined,
  options: DeletionOptions = {},
): Promise<DeletionItemResult[]> {
  const bounded = (value: number | undefined, fallback: number, max: number) =>
    Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value!))) : fallback;
  const concurrency = bounded(options.groupConcurrency, 4, 4);
  const verifyConcurrency = bounded(options.verificationConcurrency, 4, 4);
  const budget = bounded(options.maxInputBytes, 64 * 1024 * 1024, 64 * 1024 * 1024);
  const limit = verificationLimiter(verifyConcurrency, budget);
  const started = performance.now();
  // Browser-only chunk keeps Node safety tests/benchmarks on native WebCrypto.
  // Failed module/worker startup falls back to the same full native calculation.
  let hasher = nativeHashService();
  if (options.hashExecution !== 'main' && typeof Worker !== 'undefined') {
    try { hasher = await (await import('./sha256-browser')).createBrowserHashService(); }
    catch { /* Unsupported worker: retain complete main-thread verification. */ }
  }
  const metrics: DeletionMetrics = {
    elapsedMs: 0, authorizationMs: 0, permissionMs: 0, metadataMs: 0, readMs: 0,
    hashMs: 0, deleteMs: 0, verifiedFiles: 0, verifiedBytes: 0, deleteCalls: 0,
    peakChecks: 0, peakDeletes: 0, peakInputBytes: 0,
    workerHashFiles: 0, mainHashFiles: 0, hashComputeMs: 0, byteComparedFiles: 0, byteCompareMs: 0,
  };
  const results = new Map<string, DeletionItemResult>();
  let activeChecks = 0, activeDeletes = 0, inputBytes = 0;
  let stop = false;
  const checkRunning = () => { if (token.cancelled || stop) throw new DeletionStopped(); };
  const denied = (error: unknown) => error instanceof Error && ['NotAllowedError', 'SecurityError'].includes(error.name);
  const measure: Measure = async (stage, work) => {
    const start = performance.now();
    try { return await work(); } finally { metrics[stage] += performance.now() - start; }
  };
  const report = (currentFile: string, phase: DeletionProgress['phase'] = 'working') => onProgress({
    completed: results.size, total: plan.files.length, currentFile, phase,
    activeChecks, activeDeletes, verifiedBytes: metrics.verifiedBytes, elapsedMs: performance.now() - started,
  });
  const verificationJob = <T>(file: ISimilarFileEntry, size: number, work: () => Promise<T>) => limit(size, async () => {
    checkRunning();
    activeChecks += 1; inputBytes += size;
    metrics.peakChecks = Math.max(metrics.peakChecks, activeChecks);
    metrics.peakInputBytes = Math.max(metrics.peakInputBytes, inputBytes);
    try {
      report(file.relativePath);
      return await work();
    } catch (error) { if (denied(error)) stop = true; throw error; }
    finally { activeChecks -= 1; inputBytes -= size; report(file.relativePath); }
  });
  const verify = (file: ISimilarFileEntry) => verificationJob(file, access.targets.get(file.id)?.size ?? 0,
    () => verifiedParent(access, file, measure, checkRunning, metrics, hasher));
  const verifyPair = (keeper: ISimilarFileEntry, file: ISimilarFileEntry) => verificationJob(file,
    (access.targets.get(keeper.id)?.size ?? 0) + (access.targets.get(file.id)?.size ?? 0), async () => {
      // Both buffers share one reservation. Never hold one while waiting to reserve
      // the other (deadlock), or reuse either buffer for the next removal.
      const settlePair = async <T>(work: (entry: ISimilarFileEntry) => Promise<T>): Promise<[T, T]> => {
        const settled = await Promise.allSettled([keeper, file].map(async entry => {
          try { return await work(entry); }
          catch (error) { if (denied(error)) stop = true; throw error; }
        }));
        const [kept, copy] = settled;
        if (kept.status === 'rejected') {
          if (kept.reason instanceof DeletionStopped) throw kept.reason;
          throw new KeeperVerificationFailed(failureMessage(kept.reason));
        }
        if (copy.status === 'rejected') throw copy.reason;
        checkRunning();
        return [kept.value, copy.value];
      };
      const [kept, copy] = await settlePair(entry => freshTarget(access, entry, measure, checkRunning));
      const [keeperBytes, copyBytes] = await settlePair(entry => measure('readMs', () =>
        (entry === keeper ? kept : copy).fresh.arrayBuffer()));
      const result = await measure('hashMs', () => hasher.compareExact!(keeperBytes, copyBytes));
      checkRunning();
      metrics.hashComputeMs! += result.computeMs;
      metrics.byteCompareMs! += result.compareMs;
      if (result.backend === 'worker') metrics.workerHashFiles! += 1;
      else metrics.mainHashFiles! += 1;
      if (result.hex !== kept.target.fingerprint) {
        throw new KeeperVerificationFailed('文件内容或修改时间已变化，未删除；请重新扫描。');
      }
      metrics.verifiedFiles += 1; metrics.verifiedBytes += kept.fresh.size;
      if (!result.equal || copy.target.fingerprint !== kept.target.fingerprint) {
        throw new Error('副本内容与保留项不再完全一致，未删除；请重新扫描。');
      }
      metrics.verifiedFiles += 1; metrics.verifiedBytes += copy.fresh.size;
      metrics.byteComparedFiles! += 1;
      return copy.parent;
    });
  async function processGroup(group: DeletionPlan['groups'][number]) {
    let groupError: string | null = null;
    for (const file of group.selected) {
      report(file.relativePath);
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
          if (await measure('permissionMs', () => access.root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
            stop = true;
            throw new Error('目录写入权限已撤销，已停止删除。');
          }
          checkRunning();
          // Settle every started check before deleting, reporting an error or leaving.
          const anchor = group.retained[0];
          // Large pairs retain the previous single-file hashing path so one large
          // file cannot force two oversized inputs into memory together.
          const usePair = group.level === 'exact' && options.exactVerification !== 'hash' && hasher.compareExact
            && anchor.size + file.size <= budget;
          const checks = await Promise.allSettled(usePair
            ? [...group.retained.slice(1).map(verify), verifyPair(anchor, file)]
            : [...group.retained, file].map(verify));
          const keeperFailure = checks.slice(0, -1).find((check) => check.status === 'rejected');
          if (keeperFailure?.status === 'rejected' && !(keeperFailure.reason instanceof DeletionStopped)) {
            groupError = `保留项核验失败：${failureMessage(keeperFailure.reason)}`;
            throw new Error(groupError);
          }
          const targetCheck = checks[checks.length - 1];
          if (targetCheck.status === 'rejected' && targetCheck.reason instanceof KeeperVerificationFailed) {
            groupError = `保留项核验失败：${targetCheck.reason.message}`;
            throw new Error(groupError);
          }
          if (targetCheck.status === 'rejected' && !(targetCheck.reason instanceof DeletionStopped)) throw targetCheck.reason;
          checkRunning();
          if (keeperFailure || targetCheck.status !== 'fulfilled') throw new DeletionStopped();
          if (group.level === 'exact' && access.targets.get(file.id)?.fingerprint
            !== access.targets.get(group.retained[0].id)?.fingerprint) {
            groupError = '副本与保留项不再完全一致，未删除。';
            throw new Error(groupError);
          }
          activeDeletes += 1;
          metrics.peakDeletes = Math.max(metrics.peakDeletes, activeDeletes);
          try {
            report(file.relativePath);
            checkRunning();
            metrics.deleteCalls += 1;
            await measure('deleteMs', () => targetCheck.value.removeEntry(file.name, { recursive: false }));
            result.status = 'deleted';
            result.message = '已删除';
          } finally { activeDeletes -= 1; }
        }
      } catch (error) {
        if (error instanceof DeletionStopped) {
          result.status = 'cancelled'; result.message = '操作已停止，此文件未删除。';
        } else result.message = failureMessage(error);
        if (denied(error)) stop = true;
      }
      results.set(file.id, result);
      report(file.relativePath);
    }
  }
  let nextGroup = 0;
  const workers = Array.from({ length: Math.min(concurrency, plan.groups.length) }, async () => {
    try {
      while (nextGroup < plan.groups.length) await processGroup(plan.groups[nextGroup++]);
    } catch (error) { stop = true; throw error; }
  });
  // Never return while a sibling worker could still remove another file.
  const settled = await Promise.allSettled(workers);
  hasher.dispose();
  const fatal = settled.find((worker) => worker.status === 'rejected');
  if (fatal?.status === 'rejected') throw fatal.reason;
  metrics.elapsedMs = performance.now() - started;
  report('', 'finished');
  options.onMetrics?.({ ...metrics });
  // Keep the confirmed manifest order even when independent groups finish out of order.
  return plan.files.map((file) => results.get(file.id)!);
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
