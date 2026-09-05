import { ArrowDownWideNarrow, CheckSquare, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface DirectoryOption {
  path: string;
  count: number;
}

interface ToolbarProps {
  directories: DirectoryOption[];
  directoryFilter: string;
  onDirectoryFilterChange: (value: string) => void;
  largeFirst: boolean;
  onLargeFirstChange: (checked: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export default function Toolbar({
  directories,
  directoryFilter,
  onDirectoryFilterChange,
  largeFirst,
  onLargeFirstChange,
  onSelectAll,
  onDeselectAll,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={directoryFilter}
        onValueChange={onDirectoryFilterChange}
      >
        <SelectTrigger className="w-full sm:w-[240px]">
          <SelectValue placeholder="按目录筛选" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部目录</SelectItem>
          {directories.map((directory) => (
            <SelectItem
              key={directory.path}
              value={directory.path}
              className="max-w-[320px]"
            >
              <span className="block truncate">{directory.path}</span>
              <span className="text-muted-foreground">
                （{directory.count} 组）
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Switch
          id="large-first"
          checked={largeFirst}
          onCheckedChange={onLargeFirstChange}
        />
        <Label
          htmlFor="large-first"
          className="flex items-center gap-1 text-sm text-muted-foreground cursor-pointer"
        >
          <ArrowDownWideNarrow className="size-3.5" />
          大文件优先
        </Label>
      </div>

      <div className="flex flex-1" />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onSelectAll}>
          <CheckSquare className="size-4" />
          全选重复副本
        </Button>
        <Button variant="outline" size="sm" onClick={onDeselectAll}>
          <Square className="size-4" />
          取消全选
        </Button>
      </div>
      <p className="w-full text-xs text-muted-foreground">
        <span>
          「全选重复副本 / 取消全选」仅作用于当前显示的组；隐藏组的勾选状态保持不变
        </span>
        <span className="mx-1" aria-hidden="true">·</span>
        <span>大文件优先：按组内最大单文件大小降序，与勾选状态无关</span>
      </p>
    </div>
  );
}
