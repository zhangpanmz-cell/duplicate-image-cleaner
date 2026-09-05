// EXPORTS: SimilarityLevel, SIMILARITY_THRESHOLDS, ISimilarFileEntry, ISimilarGroup

/** 结果分类：完全重复 / 高度相似 / 疑似相似 */
export type SimilarityLevel = 'exact' | 'high' | 'suspected';

/**
 * 相似判定阈值（集中定义的可调整常量）：
 * - pHash 汉明距离 0-5 且 dHash 交叉校验通过 → 高度相似
 * - pHash 汉明距离 6-12 且 dHash 交叉校验通过 → 疑似相似
 * - 候选分桶：宽高比区间 / 尺寸区间 / 哈希前缀预筛，避免全量 O(n²) 比较
 */
export const SIMILARITY_THRESHOLDS = {
  /** pHash 距离 ≤ 该值 → 高度相似 */
  highMaxDistance: 5,
  /** pHash 距离 ≤ 该值 → 疑似相似（超出则不认为是相似图片） */
  suspectedMaxDistance: 12,
  /** 高度相似的 dHash 交叉校验上限 */
  highDHashMax: 10,
  /** 疑似相似的 dHash 交叉校验上限（降低误报） */
  suspectedDHashMax: 16,
  /** 分桶：宽高比桶宽 */
  aspectBucketWidth: 0.25,
  /** 分桶：尺寸桶跨度（log2 字节） */
  sizeBucketSpan: 2,
  /** 分桶：pHash 前缀（前 16 位）预筛最大距离 */
  prefixFilterMax: 8,
} as const;

export interface ISimilarFileEntry {
  /** 唯一标识 */
  id: string;
  /** 文件名（含扩展名） */
  name: string;
  /** 相对路径（目录扫描）或文件名（多选/演示） */
  relativePath: string;
  /** 所属目录路径（用于按目录筛选） */
  directory: string;
  /** 文件字节大小 */
  size: number;
  /** 图片宽度 px */
  width: number;
  /** 图片高度 px */
  height: number;
  /** SHA-256 哈希（完全重复组内一致；相似组为空串） */
  hash: string;
  /** 感知哈希 pHash（完全重复组为空串） */
  phash: string;
  /** 感知哈希 dHash（完全重复组为空串） */
  dhash: string;
  /** 与组内参考文件的 pHash 汉明距离（完全重复组为 0） */
  distance: number;
  /** 所属分类 */
  level: SimilarityLevel;
  /** 缩略图 objectURL（运行时生成） */
  thumbnailUrl: string;
  /** 是否预选待清理（仅完全重复组默认预选副本） */
  selected: boolean;
  /** 是否为保留项 */
  isKept: boolean;
  /** 来源标记：真实扫描 or 演示数据 */
  source: 'scan' | 'mock';
}

export interface ISimilarGroup {
  /** 组标识 */
  id: string;
  /** 组分类 */
  level: SimilarityLevel;
  /** 组内文件列表（≥2） */
  files: ISimilarFileEntry[];
  /** 组总大小 */
  totalSize: number;
  /** 可释放空间（已勾选待清理文件大小之和） */
  reclaimableSize: number;
}
