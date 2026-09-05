// EXPORTS: IHomePageEntry, IHomePageData, MOCK_HOME_PAGE

export interface IHomePageEntry {
  id: 'folder' | 'files' | 'demo'
  title: string
  description: string
}

export interface IHomePageFeature {
  id: string
  label: string
  description: string
}

export interface IHomePageData {
  /** 产品名 */
  title: string
  /** 一句话副标题 */
  subtitle: string
  /** 隐私说明 */
  privacyNotice: string
  /** 判定原理说明 */
  methodNote: string
  /** 特性亮点列表 */
  features: IHomePageFeature[]
  /** 三个流程入口（folder 主入口 / files 降级入口 / demo 演示入口） */
  entries: IHomePageEntry[]
}

export const MOCK_HOME_PAGE: IHomePageData = {
  title: '重复图片清理器',
  subtitle: '找出磁盘中内容相同或相似图片',
  privacyNotice: '所有处理均在浏览器本地完成，不上传任何文件',
  methodNote: '只识别内容完全相同的图片：大小分组 + SHA-256 比对，不做相似度比较，不使用 AI',
  features: [
    {
      id: 'local',
      label: '全程本地处理',
      description: '扫描与哈希计算均在本机浏览器内完成',
    },
    {
      id: 'exact',
      label: '精确判定',
      description: '大小分组后计算 SHA-256，哈希一致才算重复',
    },
    {
      id: 'formats',
      label: '支持多格式',
      description: 'JPG、PNG、WebP、GIF、BMP、TIFF，递归扫描子目录',
    },
  ],
  entries: [
    {
      id: 'folder',
      title: '选择文件夹并扫描',
      description: '递归扫描目录内所有图片文件',
    },
    {
      id: 'files',
      title: '选择多张图片体验',
      description: '不支持目录选择时的降级入口',
    },
    {
      id: 'demo',
      title: '加载演示数据',
      description: '无需授权，体验完整清理流程',
    },
  ],
}
