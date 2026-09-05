// EXPORTS: IFileEntry, IDuplicateGroup, MOCK_DUPLICATE_GROUPS
export interface IFileEntry {
  /** 唯一标识 */
  id: string
  /** 文件名（含扩展名） */
  name: string
  /** 相对路径（目录扫描）或文件名（多选/演示） */
  relativePath: string
  /** 所属目录路径（用于按目录筛选） */
  directory: string
  /** 文件字节大小 */
  size: number
  /** 图片宽度 px */
  width: number
  /** 图片高度 px */
  height: number
  /** SHA-256 哈希（同组内完全一致） */
  hash: string
  /** 缩略图 objectURL（运行时生成，mock 留空） */
  thumbnailUrl: string
  /** 是否预选待清理（副本） */
  selected: boolean
  /** 是否为组内保留项 */
  isKept: boolean
  /** 来源标记：真实扫描 or 演示数据 */
  source: 'scan' | 'mock'
}

export interface IDuplicateGroup {
  /** 组标识（哈希值） */
  id: string
  /** 组内文件列表（≥2） */
  files: IFileEntry[]
  /** 组总大小 */
  totalSize: number
  /** 可释放空间（预选副本大小之和） */
  reclaimableSize: number
}

export const MOCK_DUPLICATE_GROUPS: IDuplicateGroup[] = [
  {
    id: 'a1b2c3d4',
    files: [
      {
        id: '1',
        name: 'IMG_2041.jpg',
        relativePath: '照片/2023旅行/IMG_2041.jpg',
        directory: '照片/2023旅行',
        size: 3145728,
        width: 4032,
        height: 3024,
        hash: 'a1b2c3d4',
        thumbnailUrl: '',
        selected: false,
        isKept: true,
        source: 'mock',
      },
      {
        id: '2',
        name: '旅行合照.jpg',
        relativePath: '备份/微信/旅行合照.jpg',
        directory: '备份/微信',
        size: 3145728,
        width: 4032,
        height: 3024,
        hash: 'a1b2c3d4',
        thumbnailUrl: '',
        selected: true,
        isKept: false,
        source: 'mock',
      },
      {
        id: '3',
        name: 'IMG_2041 (1).jpg',
        relativePath: '照片/2023旅行/IMG_2041 (1).jpg',
        directory: '照片/2023旅行',
        size: 3145728,
        width: 4032,
        height: 3024,
        hash: 'a1b2c3d4',
        thumbnailUrl: '',
        selected: true,
        isKept: false,
        source: 'mock',
      },
    ],
    totalSize: 9437184,
    reclaimableSize: 6291456,
  },
  {
    id: 'e5f6a7b8',
    files: [
      {
        id: '4',
        name: '壁纸.png',
        relativePath: '壁纸/壁纸.png',
        directory: '壁纸',
        size: 2097152,
        width: 2560,
        height: 1440,
        hash: 'e5f6a7b8',
        thumbnailUrl: '',
        selected: false,
        isKept: true,
        source: 'mock',
      },
      {
        id: '5',
        name: 'wallpaper_v2.png',
        relativePath: '下载/wallpaper_v2.png',
        directory: '下载',
        size: 2097152,
        width: 2560,
        height: 1440,
        hash: 'e5f6a7b8',
        thumbnailUrl: '',
        selected: true,
        isKept: false,
        source: 'mock',
      },
    ],
    totalSize: 4194304,
    reclaimableSize: 2097152,
  },
  {
    id: 'c9d0e1f2',
    files: [
      {
        id: '6',
        name: '头像.webp',
        relativePath: '图片/头像.webp',
        directory: '图片',
        size: 51200,
        width: 512,
        height: 512,
        hash: 'c9d0e1f2',
        thumbnailUrl: '',
        selected: false,
        isKept: true,
        source: 'mock',
      },
      {
        id: '7',
        name: 'avatar_final.webp',
        relativePath: '备份/头像/avatar_final.webp',
        directory: '备份/头像',
        size: 51200,
        width: 512,
        height: 512,
        hash: 'c9d0e1f2',
        thumbnailUrl: '',
        selected: true,
        isKept: false,
        source: 'mock',
      },
    ],
    totalSize: 102400,
    reclaimableSize: 51200,
  },
]