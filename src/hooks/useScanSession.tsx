import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { logger } from '@lark-apaas/client-toolkit-lite';
import type { ICleanSummary } from '@/data/done-page';
import type { ISimilarGroup } from '@/data/similarity';
import {
  applyDeletionResults, executeDeletion, fingerprint, makeDeletionPlan,
  type DeletionProgress, type LiveDirectoryAccess, type LocalDirectoryHandle,
} from '@/lib/file-deletion';
import {
  applyDeselectAllToScope,
  applySelectAllToScope,
  computeClean,
} from '@/lib/results-scope';
import {
  createInitialProgress,
  runScan,
  ScanCancelledError,
  type IProgressReporter,
  type IScanProgress,
  type IScanToken,
  type IScannedFile,
} from '@/lib/scan-engine';

export type ScanStatus = 'idle' | 'scanning' | 'done' | 'cancelled' | 'error';
export type ScanSource = 'directory' | 'files' | 'demo';

export interface IStartScanOptions {
  source: ScanSource;
  directoryHandle?: LocalDirectoryHandle;
  collect: (
    report: IProgressReporter,
    token: IScanToken,
  ) => Promise<IScannedFile[]>;
  /** 演示数据用：每个文件间的人工延迟，让进度可见 */
  simulateDelayMs?: number;
}

interface IScanSessionContextValue {
  canDeleteFiles: boolean;
  isDeleting: boolean;
  deletionProgress: DeletionProgress;
  deletionInterrupted: boolean;
  cancelDeletion: () => void;
  deleteSelected: (scopeIds: string[], selectedIds: string[], confirmation: string) => Promise<boolean>;
  status: ScanStatus;
  source: ScanSource | null;
  progress: IScanProgress;
  groups: ISimilarGroup[];
  cleanSummary: ICleanSummary | null;
  errorMessage: string;
  startScan: (options: IStartScanOptions) => void;
  cancelScan: () => void;
  /** 切换勾选；所有组至少保留一份，删除进行中锁定。 */
  toggleFile: (groupId: string, fileId: string) => boolean;
  /** 全选副本：仅对 scopeIds 命中的完全重复组默认保留一份并预选其余；相似组与范围外组不变。scopeIds 为空 → 无操作 */
  selectAllCopies: (scopeIds: string[]) => void;
  /** 取消全选：仅对 scopeIds 命中的组清空勾选，范围外组保持原状。scopeIds 为空 → 无操作 */
  deselectAllCopies: (scopeIds: string[]) => void;
  /** 模拟移入回收站：仅处理 scopeIds 命中的组，隐藏组勾选状态原样保留；返回是否实际执行 */
  cleanSelected: (scopeIds: string[]) => boolean;
  resetSession: () => void;
}

const ScanSessionContext = createContext<IScanSessionContextValue | null>(null);

function revokeGroupUrls(groups: ISimilarGroup[]): void {
  groups.forEach((group) => {
    group.files.forEach((file) => {
      if (file.thumbnailUrl) URL.revokeObjectURL(file.thumbnailUrl);
    });
  });
}

export function ScanSessionProvider({ children }: { children: ReactNode }) {
  // The completed scan and file capabilities exist only for this document's lifetime.
  const completedSourceRef = useRef<ScanSource | null>(null);
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [source, setSource] = useState<ScanSource | null>(null);
  const [progress, setProgress] = useState<IScanProgress>(() =>
    createInitialProgress(),
  );
  const [groups, setGroups] = useState<ISimilarGroup[]>([]);
  const [cleanSummary, setCleanSummary] = useState<ICleanSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [canDeleteFiles, setCanDeleteFiles] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionInterrupted, setDeletionInterrupted] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<DeletionProgress>({ completed: 0, total: 0, currentFile: '' });
  const liveAccessRef = useRef<LiveDirectoryAccess | null>(null);
  const deletionToken = useRef<{ cancelled: boolean } | null>(null);
  const tokenRef = useRef<IScanToken | null>(null);
  // groups 的最新值镜像：事件处理器中同步读写，避免依赖 setState updater 的
  // 执行时机（React 仅在特定条件下同步调用 updater），保证返回值可靠
  const groupsRef = useRef<ISimilarGroup[]>([]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const releaseResources = useCallback(() => {
    if (tokenRef.current) tokenRef.current.cancelled = true;
    if (deletionToken.current) deletionToken.current.cancelled = true;
    tokenRef.current = null;
    deletionToken.current = null;
    liveAccessRef.current = null;
    completedSourceRef.current = null;
    revokeGroupUrls(groupsRef.current);
    groupsRef.current = [];
  }, []);

  const discardMemory = useCallback(() => {
    releaseResources();
    setGroups([]);
    setStatus('idle');
    setSource(null);
    setProgress(createInitialProgress());
    setCleanSummary(null);
    setErrorMessage('');
    setCanDeleteFiles(false);
    setIsDeleting(false);
    setDeletionInterrupted(false);
    setDeletionProgress({ completed: 0, total: 0, currentFile: '' });
  }, [releaseResources]);

  useEffect(() => {
    // A page restored from the browser's back/forward cache also starts empty.
    // In-flight work is cancelled; no file permission or old operation can resume.
    window.addEventListener('pagehide', discardMemory);
    return () => {
      window.removeEventListener('pagehide', discardMemory);
      releaseResources();
    };
  }, [discardMemory, releaseResources]);

  // No result persistence: only warn against leaving while real deletion is active.
  useEffect(() => {
    if (!isDeleting) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDeleting]);

  const updateGroups = useCallback((nextGroups: ISimilarGroup[]) => {
    groupsRef.current = nextGroups;
    setGroups(nextGroups);
  }, []);

  const report = useCallback<IProgressReporter>((patch) => {
    setProgress((prev) => ({ ...prev, ...patch }));
  }, []);

  const startScan = useCallback(
    (options: IStartScanOptions) => {
      if (deletionToken.current) return;
      liveAccessRef.current = null;
      setCanDeleteFiles(false);
      setDeletionInterrupted(false);
      if (tokenRef.current) tokenRef.current.cancelled = true;
      revokeGroupUrls(groupsRef.current);
      completedSourceRef.current = null;
      const token: IScanToken = { cancelled: false };
      tokenRef.current = token;
      setStatus('scanning');
      setSource(options.source);
      groupsRef.current = [];
      setGroups([]);
      setCleanSummary(null);
      setErrorMessage('');
      setProgress(createInitialProgress());

      void (async () => {
        // 旧任务的进度回调守卫：会话被新扫描取代后，旧任务不再回写进度，
        // 避免旧任务把新会话的扫描进度 / 状态改坏
        const scopedReport: IProgressReporter = (patch) => {
          if (tokenRef.current === token) report(patch);
        };
        let unfinishedResult: ISimilarGroup[] | null = null;
        try {
          const scanned = await options.collect(scopedReport, token);
          if (token.cancelled) throw new ScanCancelledError();
          const result = await runScan(scanned, scopedReport, token, {
            simulateDelayMs: options.simulateDelayMs,
            source: options.source === 'demo' ? 'mock' : 'scan',
          });
          unfinishedResult = result;
          let liveAccess: LiveDirectoryAccess | null = null;
          if (options.directoryHandle && options.source === 'directory') {
            liveAccess = { root: options.directoryHandle, targets: new Map() };
            const originals = new Map(scanned.map((item) => [item.relativePath, item]));
            for (const file of result.flatMap((group) => group.files)) {
              if (token.cancelled) throw new ScanCancelledError();
              const original = originals.get(file.relativePath);
              if (!original?.handle) throw new Error('未取得原文件句柄，请重新选择文件夹。');
              scopedReport({ phase: 'merging', currentFile: `核验原文件：${file.relativePath}` });
              liveAccess.targets.set(file.id, {
                handle: original.handle, path: file.relativePath.split('/').slice(1),
                size: original.file.size, lastModified: original.file.lastModified,
                fingerprint: file.hash || await fingerprint(original.file),
              });
            }
          }
          if (
            token.cancelled ||
            tokenRef.current !== token
          ) {
            // 已取消或已被新扫描取代：仅回收资源，不改写当前会话状态
            throw new ScanCancelledError();
          }
          unfinishedResult = null;
          liveAccessRef.current = liveAccess;
          completedSourceRef.current = options.source;
          setCanDeleteFiles(liveAccess !== null);
          scopedReport({ phase: 'done', currentFile: '' });
          groupsRef.current = result;
          setGroups(result);
          setStatus('done');
        } catch (error) {
          if (unfinishedResult) revokeGroupUrls(unfinishedResult);
          // 旧任务（已被新扫描取代）的取消异常不再回写状态，
          // 避免把新会话的 scanning 状态改成 cancelled
          if (tokenRef.current !== token) return;
          if (token.cancelled || error instanceof ScanCancelledError) {
            setStatus('cancelled');
          } else {
            setStatus('error');
            setErrorMessage(
              error instanceof Error ? error.message : String(error),
            );
            logger.error('扫描失败:', String(error));
          }
        }
      })();
    },
    [report],
  );

  const cancelScan = useCallback(() => {
    if (tokenRef.current) tokenRef.current.cancelled = true;
  }, []);

  const toggleFile = useCallback(
    (groupId: string, fileId: string): boolean => {
      if (deletionToken.current) return false;
      const current = groupsRef.current;
      const group = current.find((item) => item.id === groupId);
      const target = group?.files.find((file) => file.id === fileId);
      if (!group || !target) return false;

      const nextSelected = !target.selected;
      // 实际删除与演示统一保证至少留一份；不能整组删除。
      if (nextSelected) {
        const keptCount = group.files.filter((file) => !file.selected).length;
        if (keptCount <= 1) return false;
      }

      const files = group.files.map((file) =>
        file.id === fileId
          ? { ...file, selected: nextSelected, isKept: !nextSelected }
          : file,
      );
      const reclaimableSize = files
        .filter((file) => file.selected)
        .reduce((sum, file) => sum + file.size, 0);
      const nextGroups = current.map((item) =>
        item.id === groupId ? { ...group, files, reclaimableSize } : item,
      );
      updateGroups(nextGroups);
      return true;
    },
    [updateGroups],
  );

  const selectAllCopies = useCallback((scopeIds: string[]) => {
    if (deletionToken.current) return;
    // 空范围 = 无操作，不退化为全局，避免筛选状态下误改隐藏组
    if (scopeIds.length === 0) return;
    const nextGroups = applySelectAllToScope(groupsRef.current, scopeIds);
    updateGroups(nextGroups);
  }, [updateGroups]);

  const deselectAllCopies = useCallback((scopeIds: string[]) => {
    if (deletionToken.current) return;
    if (scopeIds.length === 0) return;
    const nextGroups = applyDeselectAllToScope(groupsRef.current, scopeIds);
    updateGroups(nextGroups);
  }, [updateGroups]);

  const cleanSelected = useCallback((scopeIds: string[]): boolean => {
    // Simulation is only available for generated demo images, never real scans.
    if (deletionToken.current || completedSourceRef.current !== 'demo') return false;
    // 空范围 = 无操作，不退化为全局清理隐藏组
    if (scopeIds.length === 0) return false;
    const computation = computeClean(groupsRef.current, scopeIds);
    if (!computation) return false;

    // 缩略图回收副作用集中在纯计算之后执行
    computation.revokeUrls.forEach((url) => URL.revokeObjectURL(url));

    groupsRef.current = computation.remainingGroups;
    setGroups(computation.remainingGroups);
    // 注意：这里在顶层调用 setState，而不是嵌套在 setGroups 的 updater 里
    // （updater 必须是纯函数，StrictMode 会二次调用，嵌套 setState 会在渲染阶段
    // 触发级联更新，是线上 insertBefore/removeChild 渲染错误的根因）
    const summary: ICleanSummary = {
      mode: 'simulation',
      cleanedCount: computation.cleanedCount,
      cleanedBytes: computation.cleanedBytes,
      cleanedGroups: computation.cleanedGroups,
      remainingGroups: computation.remainingGroups.length,
      source: computation.source,
    };
    setCleanSummary(summary);
    return true;
  }, []);

  const cancelDeletion = useCallback(() => {
    if (deletionToken.current) deletionToken.current.cancelled = true;
  }, []);

  const deleteSelected = useCallback(async (
    scopeIds: string[], selectedIds: string[], confirmation: string,
  ): Promise<boolean> => {
    if (deletionToken.current) return false;
    if (confirmation !== '删除') throw new Error('请输入“删除”确认不可撤销的操作。');
    const access = liveAccessRef.current;
    if (!access || completedSourceRef.current !== 'directory') {
      throw new Error('没有有效的原文件授权，请从首页选择文件夹重新扫描。');
    }
    const originalGroups = groupsRef.current;
    const plan = makeDeletionPlan(originalGroups, scopeIds, selectedIds, access);
    const token = { cancelled: false };
    deletionToken.current = token;
    setIsDeleting(true);
    setDeletionProgress({ completed: 0, total: plan.files.length, currentFile: '等待目录写入授权…' });
    let executionStarted = false;
    try {
      // Called directly on the confirmation click, before hashing/lock awaits.
      if (await access.root.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('未获得目录写入权限，没有删除任何文件。');
      }
      if (!navigator.locks) throw new Error('当前浏览器不支持安全删除锁，请使用最新版桌面 Chrome / Edge。');
      return await navigator.locks.request('duplicate-image-cleaner:permanent-delete', { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('另一个页面正在删除文件，请等待完成后重新扫描。');
        if (token.cancelled || deletionToken.current !== token) return false;
        // No durable journal or restoration. The memory token cancels on page exit,
        // and a new document must scan and explicitly authorize a new operation.
        executionStarted = true;
        const results = await executeDeletion(access, plan, token, (progress) => {
          if (deletionToken.current === token) setDeletionProgress(progress);
        });
        if (deletionToken.current !== token) return false;
        const computation = applyDeletionResults(originalGroups, results);
        const deleted = results.filter((item) => item.status === 'deleted');
        const summary: ICleanSummary = {
          mode: 'permanent', source: 'scan', results,
          cleanedCount: deleted.length, cleanedBytes: deleted.reduce((sum, item) => sum + item.size, 0),
          cleanedGroups: computation.cleanedGroups, remainingGroups: computation.remainingGroups.length,
        };
        computation.revokeUrls.forEach((url) => URL.revokeObjectURL(url));
        groupsRef.current = computation.remainingGroups;
        setGroups(computation.remainingGroups);
        setCleanSummary(summary);
        for (const item of deleted) access.targets.delete(item.id);
        return true;
      });
    } catch (error) {
      if (executionStarted && deletionToken.current === token) {
        liveAccessRef.current = null;
        setCanDeleteFiles(false);
        setDeletionInterrupted(true);
      }
      throw error;
    } finally {
      if (deletionToken.current === token) {
        deletionToken.current = null;
        setIsDeleting(false);
      }
    }
  }, []);

  const resetSession = useCallback(() => {
    if (!deletionToken.current) discardMemory();
  }, [discardMemory]);

  const value = useMemo<IScanSessionContextValue>(
    () => ({
      canDeleteFiles, isDeleting, deletionProgress, deletionInterrupted, cancelDeletion, deleteSelected,
      status,
      source,
      progress,
      groups,
      cleanSummary,
      errorMessage,
      startScan,
      cancelScan,
      toggleFile,
      selectAllCopies,
      deselectAllCopies,
      cleanSelected,
      resetSession,
    }),
    [
      canDeleteFiles, isDeleting, deletionProgress, deletionInterrupted, cancelDeletion, deleteSelected,
      status,
      source,
      progress,
      groups,
      cleanSummary,
      errorMessage,
      startScan,
      cancelScan,
      toggleFile,
      selectAllCopies,
      deselectAllCopies,
      cleanSelected,
      resetSession,
    ],
  );

  return (
    <ScanSessionContext.Provider value={value}>
      {children}
    </ScanSessionContext.Provider>
  );
}

export function useScanSession(): IScanSessionContextValue {
  const context = useContext(ScanSessionContext);
  if (!context) {
    throw new Error('useScanSession 必须在 ScanSessionProvider 内使用');
  }
  return context;
}
