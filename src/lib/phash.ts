/**
 * 感知哈希（pHash / dHash）本地计算：
 * 1. 修正 EXIF 方向（createImageBitmap 的 imageOrientation: 'from-image'）
 * 2. 缩放到固定尺寸（pHash 32×32 / dHash 9×8）并灰度化
 * 3. pHash：DCT 低频系数比较；dHash：相邻像素梯度比较
 * 所有处理均在浏览器本地完成，原图与特征均不上传。
 */

export interface IImageFeature {
  phash: string;
  dhash: string;
  width: number;
  height: number;
}

const NIBBLE_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** 两个十六进制哈希串的汉明距离（位数）；长度不一致时返回最大距离 64 */
export function hammingDistanceHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    distance += NIBBLE_POPCOUNT[diff];
  }
  return distance;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

interface ILoadedSource {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** 读取文件并修正 EXIF 方向；失败时回退到原生 img 解码 */
async function loadSource(file: File): Promise<ILoadedSource | null> {
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    try {
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImageElement(url);
        return {
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      return null;
    }
  }
}

/** 缩放绘制并转为灰度亮度矩阵 */
function grayscale(
  source: CanvasImageSource,
  width: number,
  height: number,
): Float64Array | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const luminance = new Float64Array(width * height);
  for (let i = 0; i < luminance.length; i++) {
    const offset = i * 4;
    luminance[i] =
      0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
  }
  return luminance;
}

const PHASH_SIZE = 32;
const DCT_BLOCK = 8;

/** DCT 余弦基表：cos((2x+1)·u·π / 2N) */
const DCT_COS: number[][] = (() => {
  const table: number[][] = [];
  for (let u = 0; u < DCT_BLOCK; u++) {
    table[u] = [];
    for (let x = 0; x < PHASH_SIZE; x++) {
      table[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE));
    }
  }
  return table;
})();

/** pHash：32×32 灰度 → DCT 低频 8×8 系数与均值比较 → 64 位 */
function phashFromLuminance(luminance: Float64Array): string {
  const coefficients: number[] = [];
  for (let u = 0; u < DCT_BLOCK; u++) {
    for (let v = 0; v < DCT_BLOCK; v++) {
      let sum = 0;
      for (let y = 0; y < PHASH_SIZE; y++) {
        const cosV = DCT_COS[v][y];
        for (let x = 0; x < PHASH_SIZE; x++) {
          sum += luminance[y * PHASH_SIZE + x] * DCT_COS[u][x] * cosV;
        }
      }
      coefficients.push(sum);
    }
  }
  // 均值排除直流分量（亮度整体偏移不影响感知哈希）
  let total = 0;
  for (let i = 1; i < coefficients.length; i++) total += coefficients[i];
  const average = total / (coefficients.length - 1);
  const bits = coefficients.map((value) => value > average);
  return bitsToHex(bits);
}

/** dHash：9×8 灰度 → 每行相邻像素比较 → 64 位 */
function dhashFromLuminance(luminance: Float64Array): string {
  const width = 9;
  const height = 8;
  const bits: boolean[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      bits.push(luminance[y * width + x] > luminance[y * width + x + 1]);
    }
  }
  return bitsToHex(bits);
}

function bitsToHex(bits: boolean[]): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      if (bits[i + j]) nibble |= 1 << (3 - j);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

/** 计算图片感知特征（pHash / dHash / 尺寸）；无法解码时返回 null */
export async function computeImageFeatures(
  file: File,
): Promise<IImageFeature | null> {
  const loaded = await loadSource(file);
  if (!loaded || loaded.width <= 0 || loaded.height <= 0) return null;
  const { source, width, height } = loaded;
  try {
    const forPhash = grayscale(source, PHASH_SIZE, PHASH_SIZE);
    const forDhash = grayscale(source, 9, 8);
    if (!forPhash || !forDhash) return null;
    return {
      phash: phashFromLuminance(forPhash),
      dhash: dhashFromLuminance(forDhash),
      width,
      height,
    };
  } finally {
    if (source instanceof ImageBitmap) source.close();
  }
}
