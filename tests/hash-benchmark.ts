import { createBrowserHashService } from '../src/lib/sha256-browser';
import { nativeHashService, type HashService } from '../src/lib/sha256-pool';
import { deletionFixture } from './deletion-fixture';
import { executeDeletion, makeDeletionPlan, type DeletionMetrics } from '../src/lib/file-deletion';

const button = document.querySelector<HTMLButtonElement>('#start')!;
const output = document.querySelector('#output')!;
const log = (text: string) => { output.textContent += `${text}\n`; };
async function run(factory: () => Promise<HashService> | HashService, label: string) {
  const service = await factory();
  const bytes = 6 * 1024 * 1024, count = 128;
  let next = 0, completed = 0, workerJobs = 0, computeMs = 0, maxGap = 0;
  let tick = performance.now();
  const clock = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - tick); tick = now; }, 20);
  const reference = await nativeHashService().digest(new ArrayBuffer(bytes));
  const start = performance.now();
  try {
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next++ < count) {
        const result = await service.digest(new ArrayBuffer(bytes));
        if (result.hex !== reference.hex) throw new Error('校验结果不一致');
        completed++; computeMs += result.computeMs;
        if (result.backend === 'worker') workerJobs++;
      }
    }));
    const seconds = (performance.now() - start) / 1000;
    maxGap = Math.max(maxGap, performance.now() - tick);
    log(`${label}: ${seconds.toFixed(3)} 秒; ${completed} 次完整 SHA-256; 768 MiB; 工作线程 ${workerJobs} 次; 计算调用累计 ${(computeMs / 1000).toFixed(3)} 秒; 最大 UI 计时间隔 ${maxGap.toFixed(0)} ms`);
  } finally { clearInterval(clock); service.dispose(); }
}
async function pipeline(hashExecution: 'main' | 'auto', exactVerification: 'hash' | 'bytes') {
  const f = await deletionFixture({ groupCount: 13, selectedCount: 15, bytes: 6 * 1024 * 1024 });
  const plan = makeDeletionPlan(f.groups, f.groups.map(g => g.id),
    f.groups.flatMap(g => g.files.filter(f => f.selected).map(f => f.id)), f.access);
  let metrics: DeletionMetrics | undefined;
  const result = await executeDeletion(f.access, plan, { cancelled: false }, undefined,
    { hashExecution, exactVerification, onMetrics: value => { metrics = value; } });
  if (result.some(r => r.status !== 'deleted') || f.files.size !== 13 || metrics?.verifiedFiles !== 390
    || metrics.byteComparedFiles !== (exactVerification === 'bytes' ? 195 : 0)) throw new Error('流程校验失败');
  log(`完整流程 ${hashExecution}/${exactVerification}: ${(metrics.elapsedMs / 1000).toFixed(3)} 秒; 195 项内存模拟删除/13 组; ${metrics.verifiedFiles} 次完整校验; ${metrics.verifiedBytes / 1024 / 1024} MiB; SHA ${metrics.workerHashFiles! + metrics.mainHashFiles!} 次; 字节比较 ${metrics.byteComparedFiles} 次; 输入峰值 ${metrics.peakInputBytes / 1024 / 1024} MiB; 指纹累计 ${(metrics.hashComputeMs! / 1000).toFixed(3)} 秒; 比较累计 ${(metrics.byteCompareMs! / 1000).toFixed(3)} 秒`);
}
button.onclick = async () => {
  button.disabled = true; output.textContent = '';
  log(navigator.userAgent);
  try {
    // Alternating order reduces warmup/order bias. Every round hashes equal data.
    for (const [factory, label] of [
      [nativeHashService, '主线程 1'], [createBrowserHashService, '工作线程 1'],
      [createBrowserHashService, '工作线程 2'], [nativeHashService, '主线程 2'],
    ] as const) await run(factory, label);
    for (let round = 0; round < 3; round++) {
      await pipeline('auto', 'hash'); await pipeline('auto', 'bytes');
      await pipeline('auto', 'bytes'); await pipeline('auto', 'hash');
    }
    await pipeline('main', 'hash'); await pipeline('main', 'bytes');
    log('测试通过：所有完整内容指纹一致。');
  } catch (error) { log(`失败：${String(error)}`); }
  finally { button.disabled = false; }
};
