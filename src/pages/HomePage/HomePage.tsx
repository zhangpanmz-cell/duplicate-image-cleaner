import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  FolderOpen,
  Images,
  Zap,
} from 'lucide-react';
import { MOCK_HOME_PAGE } from '@/data/home-page';
import { useScanSession } from '@/hooks/useScanSession';
import { generateDemoFiles } from '@/lib/demo-generator';
import { collectFromDirectoryHandle, type IScannedFile } from '@/lib/scan-engine';
import type { LocalDirectoryHandle } from '@/lib/file-deletion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const directoryInputProps = {
  webkitdirectory: '',
  directory: '',
} as unknown as React.InputHTMLAttributes<HTMLInputElement>;

export default function HomePage() {
  const navigate = useNavigate();
  const { startScan } = useScanSession();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const [supportsPicker] = useState(
    () =>
      typeof window !== 'undefined' &&
      'showDirectoryPicker' in window,
  );
  const [supportsWebkitDirectory] = useState(() => {
    try {
      const input = document.createElement('input');
      return 'webkitdirectory' in input;
    } catch {
      return false;
    }
  });
  const folderSupported = supportsPicker || supportsWebkitDirectory;

  const { entries } = MOCK_HOME_PAGE;
  const folderEntry = entries.find((entry) => entry.id === 'folder');
  const filesEntry = entries.find((entry) => entry.id === 'files');
  const demoEntry = entries.find((entry) => entry.id === 'demo');

  const goToScanning = () => navigate('/scanning');

  const handleFolderScan = async () => {
    if (supportsPicker) {
      try {
        const pickerWindow = window as Window & {
          showDirectoryPicker?: () => Promise<LocalDirectoryHandle>;
        };
        const dirHandle = await pickerWindow.showDirectoryPicker?.();
        if (!dirHandle) {
          folderInputRef.current?.click();
          return;
        }
        startScan({
          source: 'directory',
          directoryHandle: dirHandle,
          collect: (report, token) =>
            collectFromDirectoryHandle(dirHandle, report, token),
        });
        goToScanning();
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name !== 'AbortError') {
          toast.error('目录选择失败，请重试或改用多选图片模式');
        }
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  const handleDirectoryInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;
    const scanned: IScannedFile[] = Array.from(fileList).map((file) => ({
      file,
      relativePath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name,
    }));
    startScan({
      source: 'directory',
      collect: async (report) => {
        scanned.forEach((item, index) => {
          report({ scannedCount: index + 1, currentFile: item.relativePath });
        });
        return scanned;
      },
    });
    event.target.value = '';
    goToScanning();
  };

  const handleFilesInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;
    const scanned: IScannedFile[] = Array.from(fileList).map((file) => ({
      file,
      relativePath: file.name,
    }));
    startScan({
      source: 'files',
      collect: async (report) => {
        report({ scannedCount: scanned.length });
        return scanned;
      },
    });
    event.target.value = '';
    goToScanning();
  };

  const handleDemo = () => {
    startScan({
      source: 'demo',
      collect: (report, token) => generateDemoFiles(report, token),
      simulateDelayMs: 160,
    });
    goToScanning();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-16 space-y-12 md:space-y-16">
      {/* 主视觉区 */}
      <section className="space-y-5 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
          {MOCK_HOME_PAGE.title}
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          {MOCK_HOME_PAGE.subtitle}
        </p>
      </section>

      {/* 三个流程入口 */}
      <section className="grid gap-4 md:grid-cols-3">
        <Card
          onClick={folderSupported ? handleFolderScan : undefined}
          className={cn(
            'group transition-colors',
            folderSupported
              ? 'cursor-pointer border-primary/30 bg-primary/5 hover:border-primary/50'
              : 'opacity-60',
          )}
        >
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <FolderOpen className="size-5" />
              </div>
              {!folderSupported && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  不支持
                </Badge>
              )}
            </div>
            <div>
              <div className="font-semibold text-foreground">
                {folderEntry?.title}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {folderSupported
                  ? folderEntry?.description
                  : '当前浏览器不支持目录选择，已降级为多选图片模式'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => filesInputRef.current?.click()}
          className="cursor-pointer transition-colors hover:border-primary/40"
        >
          <CardContent className="p-5 space-y-3">
            <div className="size-10 rounded-xl bg-muted text-foreground flex items-center justify-center">
              <Images className="size-5" />
            </div>
            <div>
              <div className="font-semibold text-foreground">
                {filesEntry?.title}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {filesEntry?.description}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={handleDemo}
          className="cursor-pointer transition-colors hover:border-primary/40"
        >
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="size-10 rounded-xl bg-muted text-foreground flex items-center justify-center">
                <Zap className="size-5" />
              </div>
              <Badge variant="secondary" className="text-xs">
                演示
              </Badge>
            </div>
            <div>
              <div className="font-semibold text-foreground">
                {demoEntry?.title}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {demoEntry?.description}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <p className="text-center text-xs text-muted-foreground">
        {folderSupported
          ? '当前浏览器支持目录选择，将递归扫描所选目录及其子文件夹'
          : '当前浏览器不支持目录选择，已降级为多选图片模式，同样走完整的分组与哈希比对流程'}
      </p>

      {/* 隐藏输入：目录选择（降级）与多选图片 */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleDirectoryInputChange}
        {...directoryInputProps}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleFilesInputChange}
      />
    </div>
  );
}
