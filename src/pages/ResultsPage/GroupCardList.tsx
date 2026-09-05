import { useState } from 'react';
import { AlertTriangle, Check, Fingerprint, ShieldCheck, ZoomIn } from 'lucide-react';
import type { ISimilarGroup, SimilarityLevel } from '@/data/similarity';
import { formatBytes } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Image } from '@/components/ui/image';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface GroupCardListProps {
  groups: ISimilarGroup[];
  onToggleFile: (groupId: string, fileId: string) => void;
}

const LEVEL_META: Record<SimilarityLevel, { label: string; badge: string }> = {
  exact: {
    label: '完全一致',
    badge: 'border-primary/30 bg-primary/5 text-primary',
  },
  high: {
    label: '高度相似',
    badge: 'border-success/40 bg-success/10 text-success',
  },
  suspected: {
    label: '疑似相似',
    badge: 'border-warning/50 bg-warning/10 text-warning',
  },
};

const FILE_CHECKBOX_CLASS =
  'size-5 shrink-0 border-2 border-muted-foreground/60 cursor-pointer data-[state=checked]:bg-destructive data-[state=checked]:border-destructive data-[state=checked]:text-destructive-foreground dark:data-[state=checked]:bg-destructive focus-visible:border-destructive focus-visible:ring-destructive/30';

/** 仅表示组内存在待清理文件，不提供整组勾选操作。 */
function GroupSelectionStatus({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <span
      role="status"
      aria-label={`本组已勾选 ${count} 个待删除文件`}
      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-medium text-foreground"
    >
      <span className="grid size-5 shrink-0 place-items-center rounded-[4px] bg-destructive text-destructive-foreground">
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </span>
      已勾选 · {count} 个待删除
    </span>
  );
}

/** 放大对比弹窗：并排查看组内图片大图 */
function ZoomCompareDialog({
  files,
  level,
  open,
  onOpenChange,
}: {
  files: ISimilarGroup['files'];
  level: SimilarityLevel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            放大对比
            <Badge variant="outline" className={cn('text-xs', LEVEL_META[level].badge)}>
              {LEVEL_META[level].label}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            相似判定基于本地感知哈希，可能存在误报，请仔细对比后人工确认。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {files.map((file) => (
            <figure key={file.id} className="space-y-2">
              <Image
                src={file.thumbnailUrl}
                alt={file.name}
                className="block max-h-[55vh] w-full rounded-lg border border-border/60 bg-muted/30 object-contain"
              />
              <figcaption className="space-y-0.5 text-xs text-muted-foreground">
                <div className="font-medium text-foreground truncate" title={file.name}>
                  {file.name}
                </div>
                <div className="truncate" title={file.relativePath}>
                  {file.relativePath}
                </div>
                <div className="tabular-nums">
                  {formatBytes(file.size)} · {file.width}×{file.height}
                  {level !== 'exact' && ` · pHash 距离 ${file.distance}`}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 完全重复组卡片：共用缩略图 + 文件行列表 */
function ExactGroupCard({
  group,
  onToggleFile,
}: {
  group: ISimilarGroup;
  onToggleFile: (groupId: string, fileId: string) => void;
}) {
  const first = group.files[0];
  const selectedFiles = group.files.filter((file) => file.selected);
  const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <Card className={cn('overflow-hidden', selectedFiles.length > 0 && 'border-destructive/40')}>
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* 组共用缩略图 */}
          <div className="shrink-0 mx-auto sm:mx-0">
            <Image
              src={first.thumbnailUrl}
              alt={`重复组缩略图 ${first.name}`}
              className="block h-28 w-28 md:h-32 md:w-32 rounded-lg object-cover border border-border/60"
            />
          </div>

          <div className="flex-1 min-w-0 space-y-3">
            {/* 组信息 */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">
                    {group.files.length} 个相同文件
                  </span>
                  <Badge
                    variant="outline"
                    className={cn('gap-1 text-xs', LEVEL_META.exact.badge)}
                  >
                    <Fingerprint className="size-3" />
                    {LEVEL_META.exact.label}
                  </Badge>
                  <GroupSelectionStatus count={selectedFiles.length} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatBytes(first.size)} · {first.width}×{first.height}
                  {first.source === 'mock' && ' · 演示数据'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold tabular-nums text-primary">
                  {formatBytes(selectedBytes)}
                </div>
                <div className="text-xs text-muted-foreground">本组可释放</div>
              </div>
            </div>

            <Separator />

            {/* 文件列表 */}
            <ul className="space-y-1">
              {group.files.map((file) => (
                <li
                  key={file.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors',
                    file.selected ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/50',
                  )}
                >
                  <Checkbox
                    checked={file.selected}
                    onCheckedChange={() => onToggleFile(group.id, file.id)}
                    aria-label={`勾选待清理文件 ${file.name}`}
                    className={FILE_CHECKBOX_CLASS}
                  />
                  <Image
                    src={file.thumbnailUrl}
                    alt={file.name}
                    className="block h-10 w-10 rounded object-cover border border-border/60 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate" title={file.name}>
                        {file.name}
                      </span>
                      {file.isKept ? (
                        <Badge
                          variant="outline"
                          className={cn('shrink-0 text-xs', LEVEL_META.exact.badge)}
                        >
                          保留
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          副本
                        </Badge>
                      )}
                    </div>
                    <div
                      className="mt-0.5 text-xs text-muted-foreground truncate"
                      title={file.relativePath}
                    >
                      {file.relativePath}
                    </div>
                  </div>
                  <div className="hidden md:block text-xs text-muted-foreground tabular-nums shrink-0">
                    {file.width}×{file.height}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums shrink-0 w-16 text-right">
                    {formatBytes(file.size)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              组内至少保留一份，默认保留路径最浅的一份
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** 相似组卡片：并排缩略图 + 单张选择 + 放大对比 */
function SimilarGroupCard({
  group,
  onToggleFile,
}: {
  group: ISimilarGroup;
  onToggleFile: (groupId: string, fileId: string) => void;
}) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const meta = LEVEL_META[group.level];
  const selectedFiles = group.files.filter((file) => file.selected);
  const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const reference = group.files[0];

  return (
    <Card className={cn('overflow-hidden', selectedFiles.length > 0 && 'border-destructive/40')}>
      <CardContent className="p-4 md:p-5 space-y-4">
        {/* 组信息 */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">
                {group.files.length} 张相似图片
              </span>
              <Badge variant="outline" className={cn('text-xs', meta.badge)}>
                {meta.label}
              </Badge>
              <GroupSelectionStatus count={selectedFiles.length} />
              {reference.source === 'mock' && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  演示数据
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              距离以「{reference.name}」为参考图 · 组总大小 {formatBytes(group.totalSize)}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <div className="text-sm font-semibold tabular-nums text-primary">
                {formatBytes(selectedBytes)}
              </div>
              <div className="text-xs text-muted-foreground">已勾选</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setZoomOpen(true)}>
              <ZoomIn className="size-4" />
              放大对比
            </Button>
          </div>
        </div>

        {/* 并排缩略图 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {group.files.map((file) => (
            <div
              key={file.id}
              className={cn(
                'rounded-xl border overflow-hidden transition-colors',
                file.selected
                  ? 'border-destructive/60 bg-destructive/5'
                  : 'border-border/60',
              )}
            >
              <button
                type="button"
                className="block w-full cursor-zoom-in"
                onClick={() => setZoomOpen(true)}
                aria-label={`放大查看 ${file.name}`}
              >
                <Image
                  src={file.thumbnailUrl}
                  alt={file.name}
                  className="block aspect-[4/3] w-full object-cover"
                />
              </button>
              <div className="p-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={file.selected}
                    onCheckedChange={() => onToggleFile(group.id, file.id)}
                    aria-label={`勾选待清理文件 ${file.name}`}
                    className={cn(FILE_CHECKBOX_CLASS, 'mt-0.5')}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-sm font-medium truncate"
                      title={file.name}
                    >
                      {file.name}
                    </div>
                    <div
                      className="text-xs text-muted-foreground truncate"
                      title={file.relativePath}
                    >
                      {file.relativePath}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                  <span>{formatBytes(file.size)}</span>
                  <span>
                    {file.width}×{file.height}
                  </span>
                  <span
                    className={cn(
                      file.distance <= 5 ? 'text-success' : 'text-warning',
                      'font-medium',
                    )}
                  >
                    距离 {file.distance}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 组说明 */}
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5 text-warning shrink-0 mt-0.5" />
          相似判定可能误报，默认全部保留；请放大对比并人工确认后再手动勾选清理
        </div>

        <ZoomCompareDialog
          files={group.files}
          level={group.level}
          open={zoomOpen}
          onOpenChange={setZoomOpen}
        />
      </CardContent>
    </Card>
  );
}

export default function GroupCardList({
  groups,
  onToggleFile,
}: GroupCardListProps) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          当前筛选条件下没有重复或相似组
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) =>
        group.level === 'exact' ? (
          <ExactGroupCard key={group.id} group={group} onToggleFile={onToggleFile} />
        ) : (
          <SimilarGroupCard key={group.id} group={group} onToggleFile={onToggleFile} />
        ),
      )}
    </div>
  );
}
