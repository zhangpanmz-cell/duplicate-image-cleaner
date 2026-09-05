// EXPORTS: IDemoSimilarSpec, MOCK_DEMO_SIMILAR_FILES

export interface IDemoSimilarSpec {
  id: string;
  /** 文件名（含扩展名） */
  name: string;
  /** 相对路径（演示目录结构） */
  relativePath: string;
  /** 所属目录（用于按目录筛选） */
  directory: string;
  /** 生成图片宽度 px */
  width: number;
  /** 生成图片高度 px */
  height: number;
  /** Canvas 绘制主题 */
  theme: 'gradient' | 'landscape' | 'portrait';
  /** 绘制随机种子：同 family 的基准场景必须一致 */
  seed: number;
  /** 相似家族：同 family 基于同一基准场景生成变体 */
  family: string;
  /**
   * 变体编号：0 = 基准图；1 = 轻微修改（目标高度相似）；2 = 明显修改（目标疑似相似）
   */
  variant: number;
}

/**
 * 演示相似文件规格集（与 demodata.ts 中同 seed 的场景配对）：
 * - sim-sunset：轻微调色变体 → 目标「高度相似」
 * - sim-cat：与 cat.png（seed 5）配对的精修变体 → 目标「高度相似」
 * - sim-notes：与 notes-screenshot.png（seed 8）配对的明显修改版 → 目标「疑似相似」
 * - sim-poster：大幅修改变体 → 目标「疑似相似」
 * 注意：字节内容各不相同（SHA-256 不同），仅感知哈希接近。
 */
export const MOCK_DEMO_SIMILAR_FILES: IDemoSimilarSpec[] = [
  {
    id: 's1',
    name: '黄昏-原片.jpg',
    relativePath: 'Photos/2024/黄昏-原片.jpg',
    directory: 'Photos/2024',
    width: 900,
    height: 600,
    theme: 'gradient',
    seed: 21,
    family: 'sim-sunset',
    variant: 0,
  },
  {
    id: 's2',
    name: '黄昏-调色.jpg',
    relativePath: 'Photos/2024/黄昏-调色.jpg',
    directory: 'Photos/2024',
    width: 900,
    height: 600,
    theme: 'gradient',
    seed: 21,
    family: 'sim-sunset',
    variant: 1,
  },
  {
    id: 's3',
    name: '笔记截图-修改版.png',
    relativePath: 'Downloads/笔记截图-修改版.png',
    directory: 'Downloads',
    width: 1024,
    height: 768,
    theme: 'landscape',
    seed: 8,
    family: 'sim-notes',
    variant: 2,
  },
  {
    id: 's4',
    name: 'cat-精修.png',
    relativePath: 'Photos/cat-精修.png',
    directory: 'Photos',
    width: 640,
    height: 640,
    theme: 'gradient',
    seed: 5,
    family: 'sim-cat',
    variant: 1,
  },
  {
    id: 's5',
    name: '海报-初稿.png',
    relativePath: 'Design/海报-初稿.png',
    directory: 'Design',
    width: 800,
    height: 1200,
    theme: 'portrait',
    seed: 305,
    family: 'sim-poster',
    variant: 0,
  },
  {
    id: 's6',
    name: '海报-终稿.png',
    relativePath: 'Design/海报-终稿.png',
    directory: 'Design',
    width: 800,
    height: 1200,
    theme: 'portrait',
    seed: 305,
    family: 'sim-poster',
    variant: 3,
  },
];
