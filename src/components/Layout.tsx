import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { FileImage, ShieldCheck } from 'lucide-react';
import { ScanSessionProvider, useScanSession } from '@/hooks/useScanSession';
import { Toaster } from '@/components/ui/sonner';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';
import SessionBoundary from '@/components/SessionBoundary';
import { ensureDocumentLanguage } from '@/lib/document-language';

/** 顶栏品牌区域：图标 + 文字统一可点击，返回首页（SPA 路由，无整页刷新） */
function BrandLink() {
  const { status, cancelScan, isDeleting } = useScanSession();

  const handleClick = () => {
    // 扫描中返回首页时先取消异步扫描任务，
    // 避免旧扫描完成后状态置 done 又把用户拉回结果页
    if (status === 'scanning') cancelScan();
  };

  return (
    <Link
      to="/"
      onClick={(event) => { if (isDeleting) event.preventDefault(); else handleClick(); }}
      aria-disabled={isDeleting}
      aria-label="重复图片清理器，点击返回首页"
      className="flex items-center gap-2.5 min-w-0 rounded-lg px-1.5 py-1 -ml-1.5 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="size-7 shrink-0 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
        <FileImage className="size-4" />
      </div>
      <span className="text-sm font-semibold truncate">
        重复图片清理器
      </span>
    </Link>
  );
}

export const Layout = () => {
  const { pathname } = useLocation();
  const pagePath = pathname.replace(/\/+$/, '') || '/';
  const showPrivacyNotice = pagePath !== '/' && pagePath !== '/results';

  // 应用启动时确保根语言为 zh-CN 且禁用浏览器自动翻译
  // （平台可能重写构建产物 HTML 的 lang 属性，运行时强制纠正）
  useEffect(() => {
    ensureDocumentLanguage();
  }, []);
  return (
    <ScanSessionProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
            <BrandLink />
            {showPrivacyNotice && (
              <div className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground shrink-0">
                <ShieldCheck className="size-3.5 text-primary" />
                图片不会上传
              </div>
            )}
          </div>
        </header>
        <main className="flex-1">
          {/* 按 pathname 重置错误边界：切换路由后不受前一页的渲染异常影响 */}
          <RouteErrorBoundary key={pathname}>
            <SessionBoundary>
              <Outlet />
            </SessionBoundary>
          </RouteErrorBoundary>
        </main>
        <footer className="w-full border-t border-border/40 py-4">
          <div className="max-w-6xl mx-auto px-4 md:px-6 text-center text-xs text-muted-foreground">
            所有处理均在浏览器本地完成 · 完全重复：SHA-256 精确比对 · 相似：本地 pHash/dHash，可能误报需人工确认
            {showPrivacyNotice && <span> · 图片不会上传</span>}
          </div>
        </footer>
      </div>
      <Toaster richColors position="top-center" />
    </ScanSessionProvider>
  );
};
