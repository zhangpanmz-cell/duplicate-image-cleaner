import {
  SIMILARITY_THRESHOLDS,
  type ISimilarFileEntry,
  type ISimilarGroup,
  type SimilarityLevel,
} from '@/data/similarity';
import { computeImageFeatures, hammingDistanceHex } from '@/lib/phash';
import type { LocalDirectoryHandle, LocalFileHandle } from '@/lib/file-deletion';

export type ScanPhase =
  | 'collecting'
  | 'grouping'
  | 'hashing'
  | 'perceptual'
  | 'merging'
  | 'done';

export interface IScanProgress {
  phase: ScanPhase;
  /** 精确哈希阶段：已处理字节（仅同大小候选） */
  processedBytes: number;
  /** 精确哈希阶段：候选总字节 */
  totalBytes: number;
  /** 已扫描文件总数（含非图片） */
  scannedCount: number;
  /** 识别出的图片文件数 */
  imageCount: number;
  /** 同大小候选文件数 */
  candidateCount: number;
  /** 完全重复组数 */
  duplicateGroupCount: number;
  /** 完全重复可释放字节 */
  duplicateBytes: number;
  /** 感知哈希阶段：待处理文件数 */
  perceptualTotal: number;
  /** 感知哈希阶段：已处理文件数 */
  perceptualProcessed: number;
  /** 相似组数 */
  similarGroupCount: number;
  /** 相似组涉及字节 */
  similarBytes: number;
  /** 当前正在处理的文件 */
  currentFile: string;
}

export type IProgressReporter = (patch: Partial<IScanProgress>) => void;

export interface IScanToken {
  cancelled: boolean;
}

export class ScanCancelledError extends Error {
  constructor() {
    super('扫描已取消');
    this.name = 'ScanCancelledError';
  }
}

export interface IScannedFile {
  file: File;
  relativePath: string;
  handle?: LocalFileHandle;
}

export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
  '.tif',
];

export function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createInitialProgress(): IScanProgress {
  return {
    phase: 'collecting',
    processedBytes: 0,
    totalBytes: 0,
    scannedCount: 0,
    imageCount: 0,
    candidateCount: 0,
    duplicateGroupCount: 0,
    duplicateBytes: 0,
    perceptualTotal: 0,
    perceptualProcessed: 0,
    similarGroupCount: 0,
    similarBytes: 0,
    currentFile: '',
  };
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getDirectory(relativePath: string): string {
  const index = relativePath.lastIndexOf('/');
  if (index <= 0) return '根目录';
  return relativePath.slice(0, index);
}

function loadImageDimensions(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = document.createElement('img');
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

interface IFeatureFile {
  item: IScannedFile;
  phash: string;
  dhash: string;
  width: number;
  height: number;
}

/**
 * 扫描引擎：
 * 1. 按文件大小分组（判定链路第 1 步，顺序不可颠倒）
 * 2. 仅对同大小候选计算 SHA-256（完全重复判定）
 * 3. 对非完全重复图片本地计算感知哈希（pHash / dHash）
 * 4. 按宽高比区间、尺寸区间、哈希前缀分桶，仅在候选桶内比较汉明距离
 */
export async function runScan(
  scannedFiles: IScannedFile[],
  report: IProgressReporter,
  token: IScanToken,
  options: { simulateDelayMs?: number; source: 'scan' | 'mock' },
): Promise<ISimilarGroup[]> {
  const createdUrls: string[] = [];
  try {
    // ── 阶段一：按文件大小分组 ──
    report({ phase: 'grouping', scannedCount: scannedFiles.length, currentFile: '' });
    if (options.simulateDelayMs) await sleep(options.simulateDelayMs);

    const images = scannedFiles.filter((item) => isImageFile(item.file.name));
    report({ imageCount: images.length });

    const bySize = new Map<number, IScannedFile[]>();
    for (const item of images) {
      const list = bySize.get(item.file.size);
      if (list) list.push(item);
      else bySize.set(item.file.size, [item]);
    }
    const candidates = Array.from(bySize.values())
      .filter((list) => list.length >= 2)
      .flat();
    const totalBytes = candidates.reduce((sum, item) => sum + item.file.size, 0);
    report({ candidateCount: candidates.length, totalBytes, processedBytes: 0, phase: 'hashing' });

    // ── 阶段二：精确哈希（SHA-256）比对 ──
    const hashes = new Map<number, string>();
    let processedBytes = 0;
    for (let index = 0; index < candidates.length; index++) {
      if (token.cancelled) throw new ScanCancelledError();
      const item = candidates[index];
      report({ currentFile: item.relativePath });
      hashes.set(index, await sha256Hex(item.file));
      if (options.simulateDelayMs) await sleep(options.simulateDelayMs);
      processedBytes += item.file.size;
      report({ processedBytes });
    }

    const byHash = new Map<string, IScannedFile[]>();
    candidates.forEach((item, index) => {
      const hash = hashes.get(index) ?? '';
      const list = byHash.get(hash);
      if (list) list.push(item);
      else byHash.set(hash, [item]);
    });

    const groups: ISimilarGroup[] = [];
    const exactFiles = new Set<IScannedFile>();
    let duplicateBytes = 0;

    for (const [hash, items] of byHash) {
      if (items.length < 2) continue;
      if (token.cancelled) throw new ScanCancelledError();
      const sorted = [...items].sort(
        (a, b) =>
          a.relativePath.length - b.relativePath.length ||
          a.relativePath.localeCompare(b.relativePath),
      );
      items.forEach((item) => exactFiles.add(item));
      const entries: ISimilarFileEntry[] = [];
      for (let index = 0; index < sorted.length; index++) {
        const item = sorted[index];
        const thumbnailUrl = URL.createObjectURL(item.file);
        createdUrls.push(thumbnailUrl);
        const { width, height } = await loadImageDimensions(thumbnailUrl);
        entries.push({
          id: `exact-${hash}-${index}`,
          name: item.file.name,
          relativePath: item.relativePath,
          directory: getDirectory(item.relativePath),
          size: item.file.size,
          width,
          height,
          hash,
          phash: '',
          dhash: '',
          distance: 0,
          level: 'exact',
          thumbnailUrl,
          // 完全重复默认保留一份并预选其余副本
          selected: index > 0,
          isKept: index === 0,
          source: options.source,
        });
      }
      const reclaimable = entries[0].size * (entries.length - 1);
      duplicateBytes += reclaimable;
      groups.push({
        id: `exact-${hash}`,
        level: 'exact',
        files: entries,
        totalSize: entries[0].size * entries.length,
        reclaimableSize: reclaimable,
      });
      report({ duplicateGroupCount: groups.length, duplicateBytes });
      if (options.simulateDelayMs) await sleep(options.simulateDelayMs);
    }

    // ── 阶段三：对非完全重复图片计算感知哈希（pHash / dHash） ──
    const remaining = images.filter((item) => !exactFiles.has(item));
    report({
      phase: 'perceptual',
      perceptualTotal: remaining.length,
      perceptualProcessed: 0,
      currentFile: '',
    });

    const features: IFeatureFile[] = [];
    for (const item of remaining) {
      if (token.cancelled) throw new ScanCancelledError();
      report({ currentFile: item.relativePath });
      const feature = await computeImageFeatures(item.file);
      if (feature && feature.width > 0 && feature.height > 0) {
        features.push({
          item,
          phash: feature.phash,
          dhash: feature.dhash,
          width: feature.width,
          height: feature.height,
        });
      }
      if (options.simulateDelayMs) await sleep(options.simulateDelayMs);
      report({ perceptualProcessed: features.length });
    }

    // ── 阶段四：分桶 + 桶内比较，归并相似组 ──
    report({ phase: 'merging', currentFile: '' });
    if (options.simulateDelayMs) await sleep(options.simulateDelayMs);

    const aspectBucketOf = (feature: IFeatureFile) =>
      Math.round(feature.width / feature.height / SIMILARITY_THRESHOLDS.aspectBucketWidth);
    const sizeBucketOf = (feature: IFeatureFile) =>
      Math.floor(Math.log2(Math.max(feature.item.file.size, 1)));

    const aspectBuckets = new Map<number, IFeatureFile[]>();
    features.forEach((feature) => {
      const key = aspectBucketOf(feature);
      const list = aspectBuckets.get(key);
      if (list) list.push(feature);
      else aspectBuckets.set(key, [feature]);
    });

    // 并查集：桶内满足阈值的配对合并为同一相似组
    const parentOf = new Map<IFeatureFile, IFeatureFile>();
    const findRoot = (feature: IFeatureFile): IFeatureFile => {
      let root = feature;
      while (parentOf.get(root) !== root) root = parentOf.get(root)!;
      let current = feature;
      while (current !== root) {
        const next = parentOf.get(current)!;
        parentOf.set(current, root);
        current = next;
      }
      return root;
    };
    features.forEach((feature) => parentOf.set(feature, feature));

    const bucketKeys = Array.from(aspectBuckets.keys()).sort((a, b) => a - b);
    for (const key of bucketKeys) {
      if (token.cancelled) throw new ScanCancelledError();
      // 相邻桶合并为候选池：宽高比接近的图片才会进入同一候选池
      const pool = [
        ...(aspectBuckets.get(key) ?? []),
        ...(aspectBuckets.get(key + 1) ?? []),
      ];
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          const a = pool[i];
          const b = pool[j];
          // 尺寸区间预筛
          if (
            Math.abs(sizeBucketOf(a) - sizeBucketOf(b)) >
            SIMILARITY_THRESHOLDS.sizeBucketSpan
          ) {
            continue;
          }
          // 哈希前缀（前 16 位）预筛
          const prefixDistance = hammingDistanceHex(
            a.phash.slice(0, 4),
            b.phash.slice(0, 4),
          );
          if (prefixDistance > SIMILARITY_THRESHOLDS.prefixFilterMax) continue;
          // pHash 汉明距离
          const distance = hammingDistanceHex(a.phash, b.phash);
          if (distance > SIMILARITY_THRESHOLDS.suspectedMaxDistance) continue;
          // dHash 交叉校验，降低误报
          const dHashDistance = hammingDistanceHex(a.dhash, b.dhash);
          if (dHashDistance > SIMILARITY_THRESHOLDS.suspectedDHashMax) continue;
          const rootA = findRoot(a);
          const rootB = findRoot(b);
          if (rootA !== rootB) parentOf.set(rootA, rootB);
        }
      }
    }

    const components = new Map<IFeatureFile, IFeatureFile[]>();
    features.forEach((feature) => {
      const root = findRoot(feature);
      const list = components.get(root);
      if (list) list.push(feature);
      else components.set(root, [feature]);
    });

    let similarGroupCount = 0;
    let similarBytes = 0;
    for (const members of components.values()) {
      if (members.length < 2) continue;
      if (token.cancelled) throw new ScanCancelledError();
      // 组内等级：取成员两两 pHash 最小距离（同时记录对应 dHash 距离做交叉校验）
      let minDistance = 64;
      let minPairDHash = 64;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const distance = hammingDistanceHex(members[i].phash, members[j].phash);
          const dHashDistance = hammingDistanceHex(members[i].dhash, members[j].dhash);
          if (distance < minDistance) {
            minDistance = distance;
            minPairDHash = dHashDistance;
          }
        }
      }
      const level: SimilarityLevel =
        minDistance <= SIMILARITY_THRESHOLDS.highMaxDistance &&
        minPairDHash <= SIMILARITY_THRESHOLDS.highDHashMax
          ? 'high'
          : 'suspected';
      const reference = members[0];
      const entries: ISimilarFileEntry[] = [];
      for (let index = 0; index < members.length; index++) {
        const member = members[index];
        const thumbnailUrl = URL.createObjectURL(member.item.file);
        createdUrls.push(thumbnailUrl);
        entries.push({
          id: `sim-${similarGroupCount}-${index}`,
          name: member.item.file.name,
          relativePath: member.item.relativePath,
          directory: getDirectory(member.item.relativePath),
          size: member.item.file.size,
          width: member.width,
          height: member.height,
          hash: '',
          phash: member.phash,
          dhash: member.dhash,
          distance: hammingDistanceHex(reference.phash, member.phash),
          level,
          thumbnailUrl,
          // 相似组默认全部保留，不自动勾选清理
          selected: false,
          isKept: true,
          source: options.source,
        });
      }
      const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
      similarGroupCount += 1;
      similarBytes += totalSize;
      groups.push({
        id: `sim-${similarGroupCount}-${reference.phash.slice(0, 8)}`,
        level,
        files: entries,
        totalSize,
        reclaimableSize: 0,
      });
      report({ similarGroupCount, similarBytes });
      if (options.simulateDelayMs) await sleep(options.simulateDelayMs);
    }

    report({ phase: 'done', currentFile: '' });
    return groups;
  } catch (error) {
    createdUrls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}

/** 浏览器能力探测：是否支持目录选择（File System Access API） */
export function supportsDirectoryPicker(): boolean {
  const globalWindow = window as unknown as Record<string, unknown>;
  return typeof globalWindow.showDirectoryPicker === 'function';
}

/** 递归读取用户选择的目录，收集图片文件 */
export async function collectFromDirectoryHandle(
  rootHandle: LocalDirectoryHandle,
  report: IProgressReporter,
  token: IScanToken,
): Promise<IScannedFile[]> {
  const results: IScannedFile[] = [];
  const walk = async (
    handle: LocalDirectoryHandle | LocalFileHandle,
    parentPath: string,
  ): Promise<void> => {
    if (token.cancelled) throw new ScanCancelledError();
    if (handle.kind === 'file') {
      report({
        scannedCount: results.length + 1,
        currentFile: `${parentPath}${handle.name}`,
      });
      const file = await handle.getFile();
      results.push({
        file,
        relativePath: `${parentPath}${handle.name}`,
        handle,
      });
      return;
    }
    if (handle.kind !== 'directory' || !handle.values) return;
    report({ currentFile: `${parentPath}${handle.name}/` });
    for await (const child of handle.values()) {
      await walk(child, `${parentPath}${handle.name}/`);
    }
  };
  await walk(rootHandle, '');
  return results;
}
