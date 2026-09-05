import { type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import { useScanSession } from '@/hooks/useScanSession';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * 路由级错误边界：
 * - 不掩盖根因：捕获时通过 logger.error 记录完整错误信息 + 非隐私诊断上下文
 *   （当前 pathname、扫描状态、组数、错误堆栈、组件堆栈），并在界面上展示
 * - 不上传文件名 / 路径 / 哈希 / 图片等用户数据
 * - 可恢复：支持「重试渲染」（resetErrorBoundary）与「返回首页重新扫描」
 * - 注意：这是兜底防护，不是根因修复；文本结构 / 范围化批量操作 /
 *   旧扫描任务守卫等根因方向在各自模块修复
 */
function RouteErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { status, groups, resetSession } = useScanSession();
  // FallbackProps.error 类型为 unknown，收敛为 Error 后安全取 message / stack
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));

  const handleBackHome = () => {
    resetSession();
    resetErrorBoundary();
    navigate('/', { replace: true });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-16 md:py-24">
      <Card>
        <CardContent className="p-8 md:p-10 flex flex-col items-center text-center space-y-5">
          <div className="size-14 rounded-full bg-warning/10 text-warning flex items-center justify-center">
            <AlertTriangle className="size-7" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-foreground">
              页面渲染出现问题
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-md">
              页面遇到渲染异常，已自动停止以避免数据错乱。您的文件未被修改，
              扫描与哈希计算均在浏览器本地完成。可重试渲染或返回首页重新开始。
            </p>
          </div>
          <div className="w-full rounded-lg bg-muted/60 px-3 py-2 text-left font-mono text-xs text-muted-foreground break-all line-clamp-3">
            {String(normalizedError.message)}
          </div>
          <div className="w-full rounded-lg bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground space-y-1">
            <div>
              <span>诊断上下文（不含文件信息）：路由 </span>
              <span className="font-mono">{pathname}</span>
              <span> · 扫描状态 </span>
              <span className="font-mono">{status}</span>
              <span> · 组数 </span>
              <span className="font-mono">{formatCountSafe(groups.length)}</span>
            </div>
            <div className="font-mono text-[11px] leading-relaxed break-all line-clamp-2">
              {normalizedError.stack ?? ''}
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={resetErrorBoundary}>
              <RotateCcw className="size-4" />
              重试渲染
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

function formatCountSafe(value: number): string {
  return Number.isFinite(value) ? String(value) : '-';
}

export default function RouteErrorBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const { status, groups } = useScanSession();

  return (
    <ErrorBoundary
      FallbackComponent={RouteErrorFallback}
      onError={(error: Error, info: { componentStack?: string | null }) => {
        // 记录完整错误（含堆栈摘要与非隐私诊断上下文）供排查，不用错误边界吞掉根因；
        // 不记录文件名 / 路径 / 哈希 / 图片等用户数据
        logger.error(
          '页面渲染异常:',
          [
            `路由: ${pathname}`,
            `扫描状态: ${status}`,
            `组数: ${groups.length}`,
            String(error),
            error?.stack ?? '',
            `组件堆栈: ${info?.componentStack ?? ''}`,
          ].join('\n'),
        );
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
