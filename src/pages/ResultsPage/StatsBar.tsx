import { Eye, FolderOpen, HardDrive, Images, Layers } from 'lucide-react';
import { formatBytes, formatCount } from '@/lib/format';

interface StatsBarProps {
  exactCount: number;
  highCount: number;
  suspectedCount: number;
  fileCount: number;
  reclaimBytes: number;
}

export default function StatsBar({
  exactCount,
  highCount,
  suspectedCount,
  fileCount,
  reclaimBytes,
}: StatsBarProps) {
  const items = [
    { icon: Layers, label: '完全重复组', value: formatCount(exactCount) },
    { icon: Images, label: '高度相似组', value: formatCount(highCount) },
    { icon: Eye, label: '疑似相似组', value: formatCount(suspectedCount) },
    { icon: FolderOpen, label: '涉及文件', value: formatCount(fileCount) },
    { icon: HardDrive, label: '预计可释放', value: formatBytes(reclaimBytes) },
  ];

  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="rounded-xl border border-border/60 bg-card p-4 shadow-xs"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="size-3.5 text-primary" />
              <span>{item.label}</span>
            </div>
            <div className="mt-2 text-xl md:text-2xl font-bold tabular-nums tracking-tight text-foreground">
              <span>{item.value}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
