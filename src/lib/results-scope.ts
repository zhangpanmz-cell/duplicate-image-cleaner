// 结果页纯逻辑模块：计数、筛选、批量操作范围化、稳定排序、模拟清理计算。
// 不依赖 React / DOM，可被 ResultsPage 与单元测试共用。
import type { ISimilarGroup, SimilarityLevel } from '@/data/similarity';

/** 分类 → 中文标签（单一事实来源，页面与测试共用，避免翻译改写后语义漂移） */
export const SIMILARITY_LABEL: Record<SimilarityLevel, string> = {
  exact: '完全重复',
  high: '高度相似',
  suspected: '疑似相似',
};

export interface IGroupCounts {
  exact: number;
  high: number;
  suspected: number;
  fileCount: number;
  selectedCount: number;
  reclaimBytes: number;
}

/** 统计各组分类数量、文件总数、已勾选数与已勾选字节（不修改入参） */
export function computeGroupCounts(groups: ISimilarGroup[]): IGroupCounts {
  let exact = 0;
  let high = 0;
  let suspected = 0;
  let fileCount = 0;
  let selectedCount = 0;
  let reclaimBytes = 0;
  groups.forEach((group) => {
    if (group.level === 'exact') exact += 1;
    else if (group.level === 'high') high += 1;
    else suspected += 1;
    fileCount += group.files.length;
    group.files.forEach((file) => {
      if (file.selected) {
        selectedCount += 1;
        reclaimBytes += file.size;
      }
    });
  });
  return { exact, high, suspected, fileCount, selectedCount, reclaimBytes };
}

export interface IVisibilityFilters {
  /** 分类筛选：'all' 或具体分类 */
  level: 'all' | SimilarityLevel;
  /** 目录筛选：'all' 或具体目录（按组匹配：组内任一文件命中即显示） */
  directory: string;
}

/** 按分类 + 目录筛选出当前显示的组（保持原始顺序，不修改入参） */
export function filterVisibleGroups(
  groups: ISimilarGroup[],
  filters: IVisibilityFilters,
): ISimilarGroup[] {
  return groups.filter((group) => {
    if (filters.level !== 'all' && group.level !== filters.level) return false;
    if (filters.directory === 'all') return true;
    return group.files.some((file) => file.directory === filters.directory);
  });
}

/** 组内最大单文件大小（排序口径：与勾选状态无关） */
export function maxFileSizeOf(group: ISimilarGroup): number {
  return group.files.reduce(
    (max, file) => (file.size > max ? file.size : max),
    0,
  );
}

/**
 * 大文件优先排序：按组内最大单文件 size 降序，相同大小组 ID 升序作次级排序。
 * 返回新数组（浅拷贝），不修改入参，且与勾选状态完全无关（勾选前后顺序稳定）。
 */
export function sortGroupsByMaxFileSize(
  groups: ISimilarGroup[],
): ISimilarGroup[] {
  return [...groups].sort((a, b) => {
    const diff = maxFileSizeOf(b) - maxFileSizeOf(a);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

export interface ISelectionStats {
  selectedCount: number;
  reclaimBytes: number;
}

/** 统计一组组内已勾选文件数与字节数 */
export function statsForGroups(groups: ISimilarGroup[]): ISelectionStats {
  let selectedCount = 0;
  let reclaimBytes = 0;
  groups.forEach((group) => {
    group.files.forEach((file) => {
      if (file.selected) {
        selectedCount += 1;
        reclaimBytes += file.size;
      }
    });
  });
  return { selectedCount, reclaimBytes };
}

/**
 * 全选副本：仅对 scopeIds 命中的完全重复组生效（默认保留一份并预选其余），
 * 相似组与范围外的组保持原样。scopeIds 为空 → 原样返回（空数组代表无操作，禁止退化为全局）。
 */
export function applySelectAllToScope(
  groups: ISimilarGroup[],
  scopeIds: string[],
): ISimilarGroup[] {
  if (scopeIds.length === 0) return groups;
  const scope = new Set(scopeIds);
  return groups.map((group) => {
    if (!scope.has(group.id)) return group;
    // 高度相似 / 疑似相似组默认全部保留，不自动勾选清理
    if (group.level !== 'exact') return group;
    const files = group.files.map((file, index) => ({
      ...file,
      selected: index > 0,
      isKept: index === 0,
    }));
    const reclaimableSize = files
      .filter((file) => file.selected)
      .reduce((sum, file) => sum + file.size, 0);
    return { ...group, files, reclaimableSize };
  });
}

/**
 * 取消全选：仅对 scopeIds 命中的组清空勾选，范围外的组保持已选状态。
 * scopeIds 为空 → 原样返回。
 */
export function applyDeselectAllToScope(
  groups: ISimilarGroup[],
  scopeIds: string[],
): ISimilarGroup[] {
  if (scopeIds.length === 0) return groups;
  const scope = new Set(scopeIds);
  return groups.map((group) => {
    if (!scope.has(group.id)) return group;
    return {
      ...group,
      files: group.files.map((file) => ({
        ...file,
        selected: false,
        isKept: true,
      })),
      reclaimableSize: 0,
    };
  });
}

export interface ICleanComputation {
  /** 清理后的剩余组（保留原始顺序，隐藏组原样透传） */
  remainingGroups: ISimilarGroup[];
  cleanedCount: number;
  cleanedBytes: number;
  cleanedGroups: number;
  /** 需要回收的缩略图 objectURL（副作用由调用方执行） */
  revokeUrls: string[];
  source: 'scan' | 'mock';
}

/**
 * 模拟清理计算：仅处理 scopeIds 命中的组，隐藏组的勾选状态原样保留。
 * - scopeIds 为空或命不中任何组 → 返回 null（无操作）
 * - 组内被勾选文件从内存移除；剩余 ≥2 份的组保留（reclaimableSize 归 0）
 * - 仅剩 1 份的组不再是重复/相似组，缩略图一并回收
 * 纯函数：不修改入参、不执行 revokeObjectURL。
 */
export function computeClean(
  groups: ISimilarGroup[],
  scopeIds: string[],
): ICleanComputation | null {
  if (scopeIds.length === 0) return null;
  const scope = new Set(scopeIds);

  let cleanedCount = 0;
  let cleanedBytes = 0;
  let cleanedGroups = 0;
  const revokeUrls: string[] = [];

  const remainingGroups = groups.map((group) => {
    if (!scope.has(group.id)) return group;

    const selectedFiles = group.files.filter((file) => file.selected);
    if (selectedFiles.length > 0) {
      cleanedCount += selectedFiles.length;
      cleanedBytes += selectedFiles.reduce((sum, file) => sum + file.size, 0);
      cleanedGroups += 1;
      selectedFiles.forEach((file) => {
        if (file.thumbnailUrl) revokeUrls.push(file.thumbnailUrl);
      });
    }

    const rest = group.files.filter((file) => !file.selected);
    if (rest.length >= 2) {
      return {
        ...group,
        files: rest,
        totalSize: rest.reduce((sum, file) => sum + file.size, 0),
        reclaimableSize: 0,
      };
    }
    if (rest.length === 1 && rest[0].thumbnailUrl) {
      // 仅剩一份时不再是重复/相似组，缩略图一并回收
      revokeUrls.push(rest[0].thumbnailUrl);
    }
    return null;
  });

  if (cleanedCount === 0 && cleanedGroups === 0) {
    // 范围内没有任何勾选：本次无实际清理
    const hasScoped = groups.some((group) => scope.has(group.id));
    if (!hasScoped) return null;
  }

  const source = groups.find((group) => scope.has(group.id))?.files[0]?.source;

  return {
    remainingGroups: remainingGroups.filter(
      (group): group is ISimilarGroup => group !== null,
    ),
    cleanedCount,
    cleanedBytes,
    cleanedGroups,
    revokeUrls,
    source: source ?? 'mock',
  };
}
