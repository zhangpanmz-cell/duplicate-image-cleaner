import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FolderOpen,
  HardDrive,
  Home,
  Layers,
  SearchX,
  ShieldCheck,
} from 'lucide-react';
import { useScanSession } from '@/hooks/useScanSession';
import { formatBytes, formatCount } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function DonePage() {
  const navigate = useNavigate();
  const { cleanSummary } = useScanSession();

  const handleBackToResults = () => navigate('/results');

  const handleBackHome = () => {
    navigate('/');
  };

  // 直接访问 /done 且无清理统计：展示空态，不回退到硬编码演示统计
  if (!cleanSummary) {
    return (
      <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 md:py-24">
        <Card>
          <CardContent className="p-8 flex flex-col items-center text-center space-y-5">
            <div className="size-14 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
              <SearchX className="size-7" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground">
                暂无清理结果
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                当前页面暂无清理统计，刷新或关闭页面后不会保存。
                请返回首页重新扫描核对文件。图片不会上传。
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="outline" onClick={() => navigate('/results')}>
                <ArrowLeft className="size-4" />
                前往结果页
              </Button>
              <Button onClick={handleBackHome}>
                <Home className="size-4" />
                返回首页重新扫描
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const summary = cleanSummary;
  const real = summary.mode === 'permanent';
  const unsuccessful = summary.results?.filter((item) => item.status !== 'deleted') ?? [];

  const highlights = [
    {
      icon: HardDrive,
      label: real ? '已删除文件大小' : '模拟释放空间',
      value: formatBytes(summary.cleanedBytes),
      hint: real ? '按成功删除的文件字节数累计，不代表磁盘实际可用空间变化' : '模拟统计，按已勾选副本大小累计',
    },
    {
      icon: FolderOpen,
      label: '已清理文件',
      value: formatCount(summary.cleanedCount),
      hint: real ? `成功删除；${unsuccessful.length} 个未删除` : '已模拟移入回收站的副本数量',
    },
    {
      icon: Layers,
      label: '涉及重复组',
      value: formatCount(summary.cleanedGroups),
      hint: `剩余未处理 ${formatCount(summary.remainingGroups)} 组`,
    },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12 md:py-20 space-y-8">
      <div className="text-center space-y-4">
        <div className="inline-flex size-16 rounded-full bg-success/10 text-success items-center justify-center">
          <CheckCircle2 className="size-8" />
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          {real ? unsuccessful.length ? '删除操作结束，部分文件未删除' : '删除完成' : '模拟清理完成'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {real ? `成功删除 ${summary.cleanedCount} 个文件，未删除 ${unsuccessful.length} 个文件。未删除项保留在结果页。` : summary.cleanedCount > 0
            ? '本次勾选的重复副本已模拟移入回收站'
            : '本轮没有勾选任何副本'}
        </p>
        {real && summary.metrics && <p className="text-sm text-muted-foreground">
          本次用时 {(summary.metrics.elapsedMs / 1000).toFixed(1)} 秒（含等待授权）
        </p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {highlights.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label}>
              <CardContent className="p-5 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="size-3.5 text-primary" />
                  <span>{item.label}</span>
                </div>
                <div className="text-2xl md:text-3xl font-bold tabular-nums tracking-tight text-foreground">
                  <span>{item.value}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span>{item.hint}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {real && summary.metrics && <details className="rounded-xl border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">查看耗时明细</summary>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground">
          {([
            ['等待授权', summary.metrics.authorizationMs],
            ['权限检查', summary.metrics.permissionMs],
            ['路径与文件检查', summary.metrics.metadataMs],
            ['读取内容', summary.metrics.readMs],
            ['内容校验', summary.metrics.hashMs],
            ['系统删除', summary.metrics.deleteMs],
          ] as const).map(([label, ms]) => <div key={label}>
            <dt>{label}</dt><dd className="text-foreground tabular-nums">{(ms / 1000).toFixed(2)} 秒</dd>
          </div>)}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          分项为各调用累计耗时，并行操作有重叠，不能相加当作实际用时。仅本次页面内显示，不保存或上传。
        </p>
      </details>}

      <Card className="bg-muted/40">
        <CardContent className="p-4 flex items-start gap-2.5">
          <ShieldCheck className="size-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            {real ? '成功项已从原目录删除，无法通过本应用撤销，也不会进入系统回收站。清理统计仅在当前页面临时显示，刷新后请重新扫描核对文件。'
              : '演示说明：以上操作仅在本应用中模拟，未删除您磁盘上的任何真实文件。'}
          </p>
        </CardContent>
      </Card>

      {real && summary.results && <Card><CardContent className="p-5 space-y-3">
        <h2 className="font-semibold">本次文件处理明细</h2>
        <ul className="max-h-80 overflow-y-auto divide-y text-sm">
          {summary.results.map((item) => <li key={item.id} className="py-3 space-y-1">
            <p className="break-all">{item.path}</p>
            <p className={item.status === 'deleted' ? 'text-muted-foreground' : 'text-destructive'}>{item.status === 'deleted' ? '已删除' : item.message}</p>
          </li>)}
        </ul>
      </CardContent></Card>}

      <div className="flex flex-wrap justify-center gap-3">
        {summary.remainingGroups > 0 && (
          <Button variant="outline" onClick={handleBackToResults}>
            <ArrowLeft className="size-4" />
            返回结果页
          </Button>
        )}
        <Button onClick={handleBackHome}>
          <Home className="size-4" />
          返回首页重新扫描
        </Button>
      </div>
    </div>
  );
}
