import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Home,
  Loader2,
  SearchX,
  Trash2,
  Zap,
} from 'lucide-react';
import { useScanSession } from '@/hooks/useScanSession';
import type { SimilarityLevel } from '@/data/similarity';
import { generateDemoFiles } from '@/lib/demo-generator';
import {
  computeGroupCounts,
  filterVisibleGroups,
  SIMILARITY_LABEL,
  sortGroupsByMaxFileSize,
  statsForGroups,
} from '@/lib/results-scope';
import { formatBytes, formatCount } from '@/lib/format';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import GroupCardList from './GroupCardList';
import StatsBar from './StatsBar';
import Toolbar from './Toolbar';
import PermanentDeleteDialog from './PermanentDeleteDialog';

type TabValue = 'all' | SimilarityLevel;

/** 分类标签的固定展示顺序（exact → high → suspected） */
const LEVEL_ORDER: SimilarityLevel[] = ['exact', 'high', 'suspected'];

export default function ResultsPage() {
  const navigate = useNavigate();
  const {
    status,
    source,
    groups,
    toggleFile,
    selectAllCopies,
    deselectAllCopies,
    cleanSelected,
    cancelScan,
    startScan,
    canDeleteFiles,
    deleteSelected,
    cleanSummary,
  } = useScanSession();

  const [tab, setTab] = useState<TabValue>('all');
  const [directoryFilter, setDirectoryFilter] = useState('all');
  const [largeFirst, setLargeFirst] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const counts = useMemo(
    () =>
      groups.reduce(
        (acc, group) => {
          acc[group.level] += 1;
          return acc;
        },
        { exact: 0, high: 0, suspected: 0 } as Record<SimilarityLevel, number>,
      ),
    [groups],
  );
  const totalStats = useMemo(() => computeGroupCounts(groups), [groups]);

  // ── 无有效会话 / 扫描中 / 0 结果的分隔状态，不展示伪结果 ──
  const hasValidResults = status === 'done' && groups.length > 0;

  const directories = useMemo(() => {
    const map = new Map<string, number>();
    groups.forEach((group) => {
      const dirs = new Set(group.files.map((file) => file.directory));
      dirs.forEach((dir) => {
        map.set(dir, (map.get(dir) ?? 0) + 1);
      });
    });
    return Array.from(map.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [groups]);

  const visibleGroups = useMemo(() => {
    const list = filterVisibleGroups(groups, {
      level: tab,
      directory: directoryFilter,
    });
    // 大文件优先：按组内最大单文件大小降序（与勾选状态无关），
    // 相同大小组 ID 升序作次级排序 → 勾选前后顺序稳定
    if (!largeFirst) return list;
    return sortGroupsByMaxFileSize(list);
  }, [groups, tab, directoryFilter, largeFirst]);

  /** 当前显示的组 ID 集合：批量操作与本次模拟清理的显式范围 */
  const visibleIds = useMemo(
    () => visibleGroups.map((group) => group.id),
    [visibleGroups],
  );
  const visibleIdSet = useMemo(
    () => new Set(visibleIds),
    [visibleIds],
  );

  /** 当前显示范围内的勾选统计（底栏 / 确认弹窗 / 本次清理口径一致） */
  const scopeStats = useMemo(() => statsForGroups(visibleGroups), [visibleGroups]);
  /** 筛选范围外（隐藏组）的已勾选统计：仅作提示，不静默处理 */
  const hiddenStats = useMemo(
    () => statsForGroups(groups.filter((group) => !visibleIdSet.has(group.id))),
    [groups, visibleIdSet],
  );

  const handleToggleFile = (groupId: string, fileId: string) => {
    const allowed = toggleFile(groupId, fileId);
    if (!allowed) {
      toast.warning('每组至少保留一份文件，请先在组内保留另一份');
    }
  };

  const handleSelectAll = () => {
    // 空数组代表无操作，不退化为全局
    const hasExactInScope = visibleGroups.some(
      (group) => group.level === 'exact',
    );
    if (!hasExactInScope) {
      toast.info('当前显示的组中没有完全重复组，未做任何修改');
      return;
    }
    selectAllCopies(visibleIds);
  };

  const handleDeselectAll = () => {
    deselectAllCopies(visibleIds);
  };

  const handleShowAllGroups = () => {
    setTab('all');
    setDirectoryFilter('all');
  };

  const handleConfirmClean = () => {
    // 先关闭确认弹窗，再执行状态更新与路由跳转：
    // 避免弹窗 Portal 卸载与列表重排在同一帧叠加，降低 DOM 协调异常风险
    setConfirmOpen(false);
    const performed = cleanSelected(visibleIds);
    if (performed) {
      toast.success('已模拟移入回收站（未删除真实文件）');
      navigate('/done');
    } else {
      toast.error('当前显示范围内没有可清理的勾选项');
    }
  };

  const handleBackHome = () => {
    navigate('/');
  };

  const handleLoadDemo = () => {
    startScan({
      source: 'demo',
      collect: (report, token) => generateDemoFiles(report, token),
      simulateDelayMs: 160,
    });
    navigate('/scanning');
  };

  // ── 扫描进行中误入结果页：给出明确入口，不展示伪结果 ──
  if (status === 'scanning') {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <Card>
          <CardContent className="p-8 flex flex-col items-center text-center space-y-5">
            <Loader2 className="size-10 text-primary animate-spin" />
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">
                扫描正在进行中
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                当前会话仍在扫描，尚未生成结果。请回到扫描页查看进度，
                或取消本次扫描后返回首页。
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={() => navigate('/scanning')}>
                返回扫描页查看进度
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  cancelScan();
                  navigate('/');
                }}
              >
                取消扫描并返回首页
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── 成功扫描但 0 组：与「无会话」明确区分 ──
  if (status === 'done' && groups.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <Card>
          <CardContent className="p-8 flex flex-col items-center text-center space-y-5">
            <div className="size-14 rounded-full bg-success/10 text-success flex items-center justify-center">
              <CheckCircle2 className="size-7" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">
                {cleanSummary ? '当前没有剩余的重复或相似组' : '本轮扫描未发现重复或相似图片'}
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {cleanSummary ? '已处理组不再显示；组内保留的文件未被删除。可返回首页重新扫描磁盘现状。'
                  : '如需检查其他图片，可返回首页重新选择文件夹，或加载演示数据体验流程。'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={handleBackHome}>
                <Home className="size-4" />
                返回首页重新扫描
              </Button>
              <Button variant="outline" onClick={handleLoadDemo}>
                <Zap className="size-4" />
                加载演示数据
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── 当前页面没有扫描结果：停留并展示空态 ──
  if (!hasValidResults) {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <Card>
          <CardContent className="p-8 flex flex-col items-center text-center space-y-5">
            <div className="size-14 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <SearchX className="size-7" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">
                暂无扫描结果
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                扫描结果仅在当前页面中临时保留，刷新或关闭页面后不会保存。
                请返回首页重新选择图片扫描。
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={() => navigate('/')}>
                <Home className="size-4" />
                返回首页重新扫描
              </Button>
              <Button variant="outline" onClick={handleLoadDemo}>
                <Zap className="size-4" />
                加载演示数据
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const similarCount = counts.high + counts.suspected;
  const isFiltered = tab !== 'all' || directoryFilter !== 'all';

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12 pb-32 space-y-6">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2 flex-wrap">
            <span>
              <span>发现 </span>
              <span className="tabular-nums">
                {formatCount(groups.length)}
              </span>
              <span> 组重复与相似图片</span>
            </span>
            {source === 'demo' && (
              <Badge variant="secondary" className="text-xs">
                演示数据
              </Badge>
            )}
          </h1>
        </div>
        <Button variant="ghost" size="sm" onClick={handleBackHome}>
          <Home className="size-4" />
          返回首页
        </Button>
      </div>

      {/* 顶部统计 */}
      <StatsBar
        exactCount={counts.exact}
        highCount={counts.high}
        suspectedCount={counts.suspected}
        fileCount={totalStats.fileCount}
        reclaimBytes={totalStats.reclaimBytes}
      />

      {source !== 'demo' && !canDeleteFiles && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          当前结果没有有效的目录删除授权，仅供查看。请使用支持目录授权的浏览器，从首页选择文件夹重新扫描。
          <Button variant="ghost" size="sm" onClick={handleBackHome}>返回首页重新扫描</Button>
        </div>
      )}

      {/* 分类标签：独立外层容器叠加 pt，与统计区拉开间距（父级 space-y-6 基础上窄屏 +8px / 桌面 +24px） */}
      <div className="pt-2 md:pt-6">
        <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="all">
            全部（<span className="tabular-nums">{groups.length}</span>）
          </TabsTrigger>
          {LEVEL_ORDER.map((level) => (
            <TabsTrigger key={level} value={level}>
              {SIMILARITY_LABEL[level]}（
              <span className="tabular-nums">{formatCount(counts[level])}</span>
              ）
            </TabsTrigger>
          ))}
        </TabsList>
        </Tabs>
      </div>

      {/* 相似判定误报提示 */}
      {similarCount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3">
          <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-foreground">
            高度 / 疑似相似由本地感知哈希（pHash + dHash 汉明距离）判定，
            <span className="font-medium">可能存在误报</span>
            ，请点击「放大对比」逐张人工确认后再勾选清理；相似组不会自动预选。
          </p>
        </div>
      )}

      {/* 工具条 */}
      <Toolbar
        directories={directories}
        directoryFilter={directoryFilter}
        onDirectoryFilterChange={setDirectoryFilter}
        largeFirst={largeFirst}
        onLargeFirstChange={setLargeFirst}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
      />

      {/* 分组卡片列表 */}
      <GroupCardList groups={visibleGroups} onToggleFile={handleToggleFile} />

      {/* 底部固定操作栏：统计口径 = 当前显示范围内已勾选项，与本次清理范围一致 */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="text-sm text-muted-foreground min-w-0">
            <div className="truncate">
              <span>已勾选（当前显示范围）</span>
              <span className="mx-1 font-semibold text-foreground tabular-nums">
                {formatCount(scopeStats.selectedCount)}
              </span>
              <span>个文件 · 预计释放</span>
              <span className="mx-1 font-semibold text-primary tabular-nums">
                {formatBytes(scopeStats.reclaimBytes)}
              </span>
            </div>
            {isFiltered && hiddenStats.selectedCount > 0 && (
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">
                <span>
                  另有
                  <span className="mx-1 font-semibold text-foreground tabular-nums">
                    {formatCount(hiddenStats.selectedCount)}
                  </span>
                  个已勾选文件不在当前显示范围（不会随本次操作被清理）
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto px-1.5 py-0 text-xs text-primary"
                  onClick={handleShowAllGroups}
                >
                  查看全部组
                </Button>
              </div>
            )}
          </div>
          {source !== 'demo' ? (
            <PermanentDeleteDialog groups={visibleGroups} disabled={!canDeleteFiles || scopeStats.selectedCount === 0}
              hiddenCount={hiddenStats.selectedCount} onDelete={async (scopeIds, selectedIds, confirmation) => {
                try {
                  if (await deleteSelected(scopeIds, selectedIds, confirmation)) navigate('/done');
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : '删除未完成，请重新扫描核对文件。');
                }
              }} />
          ) : <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button disabled={scopeStats.selectedCount === 0}>
                <Trash2 className="size-4" />
                模拟移入回收站
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确认模拟移入回收站？</AlertDialogTitle>
                <AlertDialogDescription>
                  <span>
                    本次仅清理
                    <span className="mx-1 font-semibold tabular-nums">
                      {formatCount(scopeStats.selectedCount)}
                    </span>
                    个当前显示范围内已勾选的文件，预计释放
                    <span className="mx-1 font-semibold tabular-nums">
                      {formatBytes(scopeStats.reclaimBytes)}
                    </span>
                    空间。
                  </span>
                  {isFiltered && hiddenStats.selectedCount > 0 && (
                    <span className="mt-1 block">
                      另有
                      <span className="mx-1 font-semibold tabular-nums">
                        {formatCount(hiddenStats.selectedCount)}
                      </span>
                      个已勾选文件不在当前显示范围，将保留在结果页，可切换「全部」后处理。
                    </span>
                  )}
                  <span className="mt-1 block">
                    确认弹窗与文件列表中可检查各文件路径。相似组请确认已人工核对。
                    这是前端 Demo，仅模拟清理流程，不会删除您磁盘上的真实文件。
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmClean}>
                  <Trash2 className="size-4" />
                  确认模拟清理
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>}
        </div>
      </div>
    </div>
  );
}
