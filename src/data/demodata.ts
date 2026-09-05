// EXPORTS: IDemoFileSpec, MOCK_DEMO_FILES
export interface IDemoFileSpec {
  id: string
  /** 文件名（含扩展名） */
  name: string
  /** 相对路径（演示目录结构） */
  relativePath: string
  /** 所属目录（用于按目录筛选） */
  directory: string
  /** 生成图片宽度 px */
  width: number
  /** 生成图片高度 px */
  height: number
  /** Canvas 绘制主题：同组文件必须一致以保证内容相同 */
  theme: 'gradient' | 'landscape' | 'portrait'
  /** 绘制随机种子：同组文件必须一致 */
  seed: number
  /** 重复组标识：非空且相同 → 运行时生成内容完全相同的副本；空串 = 唯一文件 */
  groupKey: string
}

/**
 * 演示文件规格集：
 * - 3 组完全重复（含跨目录分布、不同文件名同内容的典型场景）
 * - 2 个唯一文件（参与扫描但不产生重复组）
 * 运行时按 spec 用 Canvas 生成 Blob，再走真实的大小分组 + SHA-256 流程
 */
export const MOCK_DEMO_FILES: IDemoFileSpec[] = [
  // ── 重复组 A：风景照（3 份副本，跨目录、不同文件名） ──
  {
    id: '1',
    name: 'sunset-01.jpg',
    relativePath: 'Photos/2023/sunset-01.jpg',
    directory: 'Photos/2023',
    width: 1200,
    height: 800,
    theme: 'gradient',
    seed: 42,
    groupKey: 'group-a',
  },
  {
    id: '2',
    name: 'IMG_2048.jpg',
    relativePath: 'Photos/backup/IMG_2048.jpg',
    directory: 'Photos/backup',
    width: 1200,
    height: 800,
    theme: 'gradient',
    seed: 42,
    groupKey: 'group-a',
  },
  {
    id: '3',
    name: '备份-风景.png',
    relativePath: 'Downloads/备份-风景.png',
    directory: 'Downloads',
    width: 1200,
    height: 800,
    theme: 'gradient',
    seed: 42,
    groupKey: 'group-a',
  },
  // ── 重复组 B：壁纸（2 份副本，同目录不同子目录） ──
  {
    id: '4',
    name: 'wallpaper.png',
    relativePath: 'Pictures/wallpaper.png',
    directory: 'Pictures',
    width: 1600,
    height: 900,
    theme: 'landscape',
    seed: 7,
    groupKey: 'group-b',
  },
  {
    id: '5',
    name: 'wallpaper-copy.png',
    relativePath: 'Pictures/screenshots/wallpaper-copy.png',
    directory: 'Pictures/screenshots',
    width: 1600,
    height: 900,
    theme: 'landscape',
    seed: 7,
    groupKey: 'group-b',
  },
  // ── 重复组 C：聊天图片（2 份副本） ──
  {
    id: '6',
    name: 'avatar-old.bmp',
    relativePath: 'Documents/avatar-old.bmp',
    directory: 'Documents',
    width: 800,
    height: 1200,
    theme: 'portrait',
    seed: 99,
    groupKey: 'group-c',
  },
  {
    id: '7',
    name: 'wechat-img.bmp',
    relativePath: 'Downloads/wechat-img.bmp',
    directory: 'Downloads',
    width: 800,
    height: 1200,
    theme: 'portrait',
    seed: 99,
    groupKey: 'group-c',
  },
  // ── 唯一文件（参与扫描，不产生重复组） ──
  {
    id: '8',
    name: 'cat.png',
    relativePath: 'Photos/cat.png',
    directory: 'Photos',
    width: 640,
    height: 640,
    theme: 'gradient',
    seed: 5,
    groupKey: '',
  },
  {
    id: '9',
    name: 'notes-screenshot.png',
    relativePath: 'Pictures/screenshots/notes-screenshot.png',
    directory: 'Pictures/screenshots',
    width: 1024,
    height: 768,
    theme: 'landscape',
    seed: 8,
    groupKey: '',
  },
]