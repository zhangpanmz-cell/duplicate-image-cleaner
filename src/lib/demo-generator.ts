import { type IDemoFileSpec, MOCK_DEMO_FILES } from '@/data/demodata';
import {
  type IDemoSimilarSpec,
  MOCK_DEMO_SIMILAR_FILES,
} from '@/data/demo-similar';
import {
  ScanCancelledError,
  sleep,
  type IProgressReporter,
  type IScanToken,
  type IScannedFile,
} from '@/lib/scan-engine';

interface ISceneSpec {
  width: number;
  height: number;
  theme: 'gradient' | 'landscape' | 'portrait';
  seed: number;
}

/** 确定性伪随机（同 seed → 同序列） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawThemedImage(spec: ISceneSpec): HTMLCanvasElement {
  const { width, height, theme, seed } = spec;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const rand = mulberry32(seed);

  if (theme === 'gradient') {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#8fd8c6');
    gradient.addColorStop(1, '#eef7f4');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.arc(rand() * width, rand() * height, 20 + rand() * 120, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(20, 120, 105, ${0.06 + rand() * 0.12})`;
      ctx.fill();
    }
  } else if (theme === 'landscape') {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#bfe3f2');
    sky.addColorStop(1, '#eef7f4');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath();
    ctx.arc(width * 0.75, height * 0.25, 40 + rand() * 20, 0, Math.PI * 2);
    ctx.fill();
    const layerColors = ['#9fc4b7', '#7fae9d', '#5d8a72'];
    for (let layer = 0; layer < layerColors.length; layer++) {
      ctx.fillStyle = layerColors[layer];
      ctx.beginPath();
      ctx.moveTo(0, height);
      const segments = 6;
      for (let s = 0; s <= segments; s++) {
        const x = (width / segments) * s;
        const y = height * (0.45 + layer * 0.15) - rand() * height * 0.15;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#125e52');
    gradient.addColorStop(1, '#d9efe9');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 10; i++) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.08 + rand() * 0.15})`;
      ctx.lineWidth = 4 + rand() * 20;
      ctx.beginPath();
      ctx.arc(
        width / 2,
        height / 2,
        40 + rand() * Math.min(width, height) * 0.5,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }
  return canvas;
}

/**
 * 基于基准场景生成“相似但不相同”的变体（字节级不同，感知哈希接近）：
 * - variant 1：轻微缩放（1.04）+ 轻微提亮 → 目标「高度相似」
 * - variant 2：明显缩放（1.22）+ 提亮 + 底部暗带 → 目标「疑似相似」
 * - variant 3：大幅缩放（1.35）+ 强提亮 + 更宽暗带 → 目标「疑似相似」
 */
function applyVariant(
  base: HTMLCanvasElement,
  variant: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return base;

  if (variant === 0) {
    ctx.drawImage(base, 0, 0);
    return canvas;
  }

  // 轻微“裁切感”：内容整体放大后居中
  const scale = variant === 1 ? 1.04 : variant === 2 ? 1.22 : 1.35;
  const drawWidth = canvas.width * scale;
  const drawHeight = canvas.height * scale;
  ctx.drawImage(
    base,
    (canvas.width - drawWidth) / 2,
    (canvas.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );

  // 亮度调整（模拟后期调色）
  const brightness = variant === 1 ? 1.05 : variant === 2 ? 1.12 : 1.18;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.min(255, Math.round(pixels[i] * brightness));
    pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * brightness));
    pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * brightness));
  }
  ctx.putImageData(imageData, 0, 0);

  // 明显修改：底部暗带（模拟加字幕条）
  if (variant >= 2) {
    const bandHeight = Math.round(canvas.height * (variant === 2 ? 0.12 : 0.16));
    ctx.fillStyle = 'rgba(15, 40, 35, 0.35)';
    ctx.fillRect(0, canvas.height - bandHeight, canvas.width, bandHeight);
  }
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('演示图片生成失败'));
      },
      'image/png',
    );
  });
}

function createFile(blob: Blob, name: string): File {
  return new File([blob], name, {
    type: 'image/png',
    lastModified: 1234567890,
  });
}

/**
 * 演示数据：
 * - 完全重复：同 groupKey 复用同一 Blob（字节级完全一致），走真实 SHA-256 链路
 * - 相似图片：同 family 基于同一基准场景生成变体（字节不同、感知哈希接近），
 *   覆盖「高度相似 / 疑似相似」两类，走真实 pHash/dHash 链路
 */
export async function generateDemoFiles(
  report: IProgressReporter,
  token: IScanToken,
): Promise<IScannedFile[]> {
  const files: IScannedFile[] = [];
  const blobCache = new Map<string, Blob>();
  const sceneCache = new Map<string, HTMLCanvasElement>();

  // ── 完全重复 + 唯一文件 ──
  for (const spec of MOCK_DEMO_FILES) {
    if (token.cancelled) throw new ScanCancelledError();
    let blob = spec.groupKey ? blobCache.get(spec.groupKey) : undefined;
    if (!blob) {
      blob = await canvasToBlob(drawThemedImage(spec));
      if (spec.groupKey) blobCache.set(spec.groupKey, blob);
      await sleep(140);
    }
    const relativePath = `演示数据/${spec.relativePath}`;
    files.push({ file: createFile(blob, spec.name), relativePath });
    report({
      scannedCount: files.length,
      imageCount: files.length,
      currentFile: relativePath,
    });
    await sleep(120);
  }

  // ── 相似文件（与同 seed 的既有文件或 family 基准配对） ──
  for (const spec of MOCK_DEMO_SIMILAR_FILES) {
    if (token.cancelled) throw new ScanCancelledError();
    let base = sceneCache.get(spec.family);
    if (!base) {
      base = drawThemedImage(spec);
      sceneCache.set(spec.family, base);
      await sleep(100);
    }
    const blob = await canvasToBlob(applyVariant(base, spec.variant));
    const relativePath = `演示数据/${spec.relativePath}`;
    files.push({ file: createFile(blob, spec.name), relativePath });
    report({
      scannedCount: files.length,
      imageCount: files.length,
      currentFile: relativePath,
    });
    await sleep(120);
  }

  return files;
}
