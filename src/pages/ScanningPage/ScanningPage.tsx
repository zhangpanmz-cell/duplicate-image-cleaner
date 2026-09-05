import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Home,
  Loader2,
  X,
} from 'lucide-react';
import { useScanSession } from '@/hooks/useScanSession';
import { formatBytes, formatCount } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const PHASE_STEPS: Array<{ key: string; label: string }> = [
  { key: 'collecting', label: '遍历目录收集文件' },
  { key: 'grouping', label: '按文件大小分组' },
  { key: 'hashing', label: '精确哈希（SHA-256）' },
  { key: 'perceptual', label: '感知哈希（pHash/dHash）' },
  { key: 'merging', label: '相似分组归并' },
];

const PHASE_ORDER: Record<string, number> = {
  collecting: 0,
  grouping: 1,
  hashing: 2,
  perceptual: 3,
  merging: 4,
  done: 5,
};

export default function ScanningPage() {
  const navigate = useNavigate();
  const { status, source, progress, groups, cancelScan, errorMessage } =
    useScanSession();

  // 直接访问 /scanning 但尚未开始扫描 → 回首页
  useEffect(() => {
    if (status === 'idle') {
      navigate('/', { replace: true });
    }
  }, [status, navigate]);

  // 扫描完成且发现重复 → 进入结果页
  useEffect(() => {
    if (status === 'done' && groups.length > 0) {
      navigate('/results', { replace: true });
    }
  }, [status, groups.length, navigate]);

  const percent = useMemo(() => {
    // 感知哈希阶段按文件数计进度，其余阶段按字节数计
    if (progress.phase === 'perceptual') {
      if (progress.perceptualTotal <= 0) return 0;
      return Math.min(
        100,
        Math.round(
          (progress.perceptualProcessed / progress.perceptualTotal) * 100,
        ),
      );
    }
    if (progress.totalBytes <= 0) return 0;
    return Math.min(
      100,
      Math.round((progress.processedBytes / progress.totalBytes) * 100),
    );
  }, [
    progress.phase,
    progress.perceptualProcessed,
    progress.perceptualTotal,
    progress.processedBytes,
    progress.totalBytes,
  ]);

  const currentPhaseIndex = PHASE_ORDER[progress.phase] ?? 0;

  const stats = [
    { label: '已扫描文件', value: formatCount(progress.scannedCount) },
    { label: '识别图片', value: formatCount(progress.imageCount) },
    { label: '哈希候选', value: formatCount(progress.candidateCount) },
    { label: '完全重复组', value: formatCount(progress.duplicateGroupCount) },
    { label: '相似组', value: formatCount(progress.similarGroupCount) },
    {
      label: '可释放空间',
      value: formatBytes(progress.duplicateBytes),
    },
  ];

  const handleCancel = () => {
    cancelScan();
    navigate('/');
  };

  // 空结果态：扫描完成但未发现重复
  if (status === 'done' && groups.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <Card>
          <CardContent className="p-8 md:p-12 flex flex-col items-center text-center space-y-5">
            <div className="size-16 rounded-full bg-success/10 text-success flex items-center justify-center">
              <CheckCircle2 className="size-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                未发现重复或相似图片
              </h2>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                本次共扫描 {formatCount(progress.scannedCount)} 个文件，识别{' '}
                {formatCount(progress.imageCount)}{' '}
                张图片。经过大小分组、SHA-256 精确比对与本地感知哈希（pHash / dHash）
                比较，没有找到内容一致或足够相似的图片。所有处理均在您的浏览器本地完成，没有上传任何文件。
              </p>
            </div>
            <Button onClick={() => navigate('/')}>
              <Home className="size-4" />
              返回首页重新扫描
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 错误态
  if (status === 'error') {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <Card>
          <CardContent className="p-8 md:p-12 flex flex-col items-center text-center space-y-5">
            <div className="size-16 rounded-full bg-warning/10 text-warning flex items-center justify-center">
              <AlertTriangle className="size-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                扫描出现问题
              </h2>
              <p className="text-sm text-muted-foreground max-w-md">
                {errorMessage || '扫描过程中发生未知错误，请返回首页重试。'}
              </p>
            </div>
            <Button onClick={() => navigate('/')}>
              <Home className="size-4" />
              返回首页
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 扫描进行中
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-16 space-y-8">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          正在本地扫描
          {source === 'demo' && (
            <Badge variant="secondary" className="text-xs">
              演示数据
            </Badge>
          )}
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          正在识别重复与相似图片
        </h1>
        <p className="text-sm text-muted-foreground">
          所有处理均在浏览器本地完成，图片不会上传
        </p>
      </div>

      <Card>
        <CardContent className="p-6 md:p-8 space-y-6">
          {/* 阶段步骤 */}
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
            {PHASE_STEPS.map((step, index) => {
              const isDone = currentPhaseIndex > index;
              const isActive = currentPhaseIndex === index;
              return (
                <li
                  key={step.key}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2.5 py-1',
                    isActive && 'bg-primary/10 text-primary font-medium',
                    isDone && 'text-muted-foreground',
                    !isDone && !isActive && 'text-muted-foreground/60',
                  )}
                >
                  {isDone ? (
                    <Check className="size-3.5 shrink-0 text-success" />
                  ) : isActive ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin" />
                  ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-50" />
                  )}
                  {step.label}
                  {index < PHASE_STEPS.length - 1 && (
                    <span className="text-muted-foreground/40 ml-1">›</span>
                  )}
                </li>
              );
            })}
          </ol>

          {/* 进度条 */}
          <div className="space-y-2">
            {progress.phase === 'perceptual' ? (
              progress.perceptualTotal > 0 ? (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      感知哈希进度（{formatCount(progress.perceptualProcessed)} /{' '}
                      {formatCount(progress.perceptualTotal)} 张）
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {percent}%
                    </span>
                  </div>
                  <Progress value={percent} />
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      正在准备感知哈希…
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatCount(progress.scannedCount)} 个文件
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                  </div>
                </>
              )
            ) : progress.totalBytes > 0 ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    哈希进度（{formatBytes(progress.processedBytes)} /{' '}
                    {formatBytes(progress.totalBytes)}）
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {percent}%
                  </span>
                </div>
                <Progress value={percent} />
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {progress.phase === 'collecting'
                      ? '正在收集文件…'
                      : '正在准备分组…'}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatCount(progress.scannedCount)} 个文件
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                </div>
              </>
            )}
          </div>

          {/* 当前处理文件 */}
          {progress.currentFile && (
            <div className="rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground truncate">
              {progress.currentFile}
            </div>
          )}

          {/* 实时统计 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-border/60 bg-card px-3 py-2.5"
              >
                <div className="text-lg font-bold tabular-nums text-foreground">
                  {stat.value}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-center pt-1">
            <Button variant="outline" size="sm" onClick={handleCancel}>
              <X className="size-4" />
              取消扫描
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
