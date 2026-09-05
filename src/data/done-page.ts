// src/data/done-page.ts
// EXPORTS: ICleanSummary, MOCK_CLEAN_SUMMARIES

export interface ICleanSummary {
  /** 示例数据可省略；实际操作由当前页面明确设置。 */
  mode?: 'simulation' | 'permanent';
  results?: import('@/lib/file-deletion').DeletionItemResult[];
  metrics?: import('@/lib/file-deletion').DeletionMetrics;
  /** 成功清理的文件数 */
  cleanedCount: number;
  /** 已模拟释放的字节数 */
  cleanedBytes: number;
  /** 本次清理涉及的重复组数 */
  cleanedGroups: number;
  /** 结果页剩余未处理的重复组数 */
  remainingGroups: number;
  /** 来源标记：真实扫描 or 演示数据 */
  source: 'scan' | 'mock';
}

/** 演示用清理统计（真实流程中由 state 程序化统计生成，此处仅供完成页预览/兜底） */
export const MOCK_CLEAN_SUMMARIES: ICleanSummary[] = [
  {
    cleanedCount: 12,
    cleanedBytes: 48 * 1024 * 1024,
    cleanedGroups: 4,
    remainingGroups: 1,
    source: 'mock',
  },
  {
    cleanedCount: 35,
    cleanedBytes: 1024 * 1024 * 1024 + 200 * 1024 * 1024,
    cleanedGroups: 11,
    remainingGroups: 0,
    source: 'mock',
  },
  {
    cleanedCount: 3,
    cleanedBytes: 2 * 1024 * 1024 + 300 * 1024,
    cleanedGroups: 2,
    remainingGroups: 3,
    source: 'mock',
  },
];
