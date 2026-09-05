import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useScanSession } from '@/hooks/useScanSession';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format';
import { Progress } from '@/components/ui/progress';

/** Only guards live deletion; never reads or saves results. */
export default function SessionBoundary({ children }: { children: ReactNode }) {
  const { isDeleting, deletionProgress, cancelDeletion, deletionInterrupted } = useScanSession();
  const [stopping, setStopping] = useState(false);
  useEffect(() => { if (!isDeleting) setStopping(false); }, [isDeleting]);

  if (isDeleting) {
    return <div className="max-w-2xl mx-auto px-6 py-20 space-y-5 text-center" role="status" aria-live="polite">
      <Loader2 className="size-9 mx-auto animate-spin text-destructive" />
      <h1 className="text-xl font-semibold">{stopping ? '正在停止后续删除…'
        : deletionProgress.phase === 'authorizing' ? '等待目录写入授权…' : '正在核验并删除文件…'}</h1>
      <p>{deletionProgress.completed} / {deletionProgress.total}</p>
      <Progress aria-label="文件处理进度" value={deletionProgress.total ? deletionProgress.completed / deletionProgress.total * 100 : 0} />
      {deletionProgress.phase === 'working' && <p className="text-sm text-muted-foreground">
        校验中 {deletionProgress.activeChecks ?? 0} 个 · 删除中 {deletionProgress.activeDeletes ?? 0} 个
        <span className="block mt-1">已完整校验 {formatBytes(deletionProgress.verifiedBytes ?? 0)} 数据（含重复核验）</span>
      </p>}
      <p className="text-sm break-all text-muted-foreground">{deletionProgress.currentFile}</p>
      <p className="text-sm">请勿关闭或刷新页面。停止操作不会恢复已经删除的文件，已经提交给系统的删除可能仍会完成。</p>
      <Button variant="outline" disabled={stopping} onClick={() => { setStopping(true); cancelDeletion(); }}>停止后续删除</Button>
    </div>;
  }

  return <>
    {deletionInterrupted && <div className="max-w-6xl mx-auto px-6 pt-4 text-sm text-destructive" role="alert">
      删除过程意外中断，部分文件可能已删除。请重新选择文件夹扫描核对，不会自动重试。
    </div>}
    {children}
  </>;
}
