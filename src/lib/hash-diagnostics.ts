import type { HashService } from './sha256-pool';

export interface DiagnosticCase { label: string; engine: 'native' | 'wasm'; threads: number; round: number }
export interface DiagnosticResult extends DiagnosticCase {
  status: 'passed' | 'unavailable'; seconds?: number; mibPerSecond?: number; message?: string;
}
export const PROBE_BYTES = 4 * 1024 * 1024;
// Independently checked with Node/OpenSSL. Every byte is 0x49; not any user data.
export const PROBE_HASH = '5a88cdf6f17b946f505ab4774fed05e88d6d8d5d99d087dac4593425893c09d2';
const cases: Omit<DiagnosticCase, 'round'>[] = [
  { label: '原生计算 · 单线程', engine: 'native', threads: 1 },
  { label: '原生计算 · 四线程', engine: 'native', threads: 4 },
  { label: 'WASM 计算 · 四线程', engine: 'wasm', threads: 4 },
];

/** Standalone synthetic computation only: no scan/deletion imports or storage.
 * At most 4 transferred 4-MiB inputs plus one reusable synthetic template.
 * Opposite round order reduces (but does not eliminate) warmup/order bias. */
export async function runHashDiagnostics(
  factory: (test: DiagnosticCase) => Promise<HashService>, signal: AbortSignal,
  onProgress: (label: string, results: DiagnosticResult[]) => void,
): Promise<DiagnosticResult[]> {
  const payload = new Uint8Array(PROBE_BYTES).fill(73);
  const results: DiagnosticResult[] = [];
  const check = () => { if (signal.aborted) throw new DOMException('自检已停止', 'AbortError'); };
  for (const [round, sequence] of [[1, cases], [2, [...cases].reverse()]] as const) {
    for (const definition of sequence) {
      check();
      const test = { ...definition, round };
      onProgress(`第 ${round} 轮：${test.label}`, [...results]);
      let service: HashService | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const stop = () => service?.dispose();
      signal.addEventListener('abort', stop, { once: true });
      try {
        service = await factory(test); check();
        timer = setTimeout(() => { timedOut = true; stop(); }, 30000);
        const one = async () => {
          check();
          const result = await service!.digest(payload.slice().buffer); check();
          if (result.backend !== 'worker') throw new Error('工作线程未能启动，该项不参与速度比较。');
          if (result.hex !== PROBE_HASH) throw new Error('完整内容校验不一致，该项不参与速度比较。');
        };
        // Warm up all lanes outside the measured interval; still verify outputs.
        const warmup = await Promise.allSettled(Array.from({ length: test.threads }, one));
        const warmError = warmup.find(r => r.status === 'rejected');
        if (warmError?.status === 'rejected') throw warmError.reason;
        let next = 0;
        const start = performance.now();
        const jobs = await Promise.allSettled(Array.from({ length: test.threads }, async () => {
          while (next++ < 8) await one();
        }));
        const error = jobs.find(r => r.status === 'rejected');
        if (error?.status === 'rejected') throw error.reason;
        check();
        const seconds = Math.max(0.000001, (performance.now() - start) / 1000);
        results.push({ ...test, status: 'passed', seconds, mibPerSecond: 32 / seconds });
      } catch (error) {
        check();
        results.push({ ...test, status: 'unavailable', message: timedOut ? '该项测试超时，不参与速度比较。'
          : error instanceof Error ? error.message : '计算方式不可用' });
      } finally {
        clearTimeout(timer); signal.removeEventListener('abort', stop); service?.dispose();
      }
      onProgress(`已完成 ${results.length} / 6 项`, [...results]);
    }
  }
  return results;
}
