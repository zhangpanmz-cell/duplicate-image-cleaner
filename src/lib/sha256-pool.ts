/** A task-local computation pool, not a fingerprint cache. No filesystem handles
 * or paths leave the caller; transferred buffers are freshly read on every check. */
export interface HashResult {
  hex: string;
  computeMs: number;
  backend: 'worker' | 'main';
}
export interface HashService {
  digest(buffer: ArrayBuffer): Promise<HashResult>;
  dispose(): void;
}
export interface HashWorkerPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { preventDefault(): void }) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: { id: number; buffer: ArrayBuffer }, transfer: ArrayBuffer[]): void;
  terminate(): void;
}
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function nativeHashService(): HashService {
  let closed = false;
  return {
    async digest(buffer) {
      if (closed) throw new Error('内容校验已结束，请重新扫描。');
      const start = performance.now();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      return { hex: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''),
        computeMs: performance.now() - start, backend: 'main' };
    },
    dispose() { closed = true; },
  };
}

/** Worker startup failure (e.g. CSP) falls back before transferring ANY data.
 * Once started, a worker failure rejects all checks, never approves or retries a
 * detached buffer. One digest per worker; input limits are enforced by the caller. */
export async function createHashPool(
  factory: () => HashWorkerPort, count = 4, startupMs = 2000, jobTimeoutMs = 120_000,
): Promise<HashService> {
  type Job = { id: number; buffer: ArrayBuffer; resolve: (result: HashResult) => void; reject: (error: Error) => void };
  type Slot = { port: HashWorkerPort; job?: Job; timer?: ReturnType<typeof setTimeout> };
  const slots: Slot[] = [];
  const queue: Job[] = [];
  let failure: Error | undefined;
  let nextId = 0;
  const pendingStartup = new Set<() => void>();
  function close(error = new Error('内容校验线程中断，未删除；请重新扫描。')) {
    failure ??= error;
    for (const cancel of pendingStartup) cancel();
    pendingStartup.clear();
    for (const slot of slots) {
      clearTimeout(slot.timer);
      slot.port.onmessage = null; slot.port.onerror = null; slot.port.onmessageerror = null;
      slot.port.terminate();
      slot.job?.reject(failure); slot.job = undefined;
    }
    for (const job of queue.splice(0)) job.reject(failure);
  }
  function drain() {
    if (failure) return;
    for (const slot of slots) {
      if (slot.job || !queue.length) continue;
      const job = queue.shift()!;
      slot.job = job;
      slot.timer = setTimeout(() => close(), jobTimeoutMs);
      try { slot.port.postMessage({ id: job.id, buffer: job.buffer }, [job.buffer]); }
      catch { close(); return; }
    }
  }
  try {
    // Create all ports before awaiting: startup can overlap, never hashes a photo.
    for (let i = 0; i < Math.max(1, Math.min(4, Math.floor(count) || 1)); i++) slots.push({ port: factory() });
    await Promise.all(slots.map(slot => new Promise<void>((resolve, reject) => {
      const failed = () => { clearTimeout(slot.timer); reject(new Error('Worker unavailable')); };
      pendingStartup.add(failed);
      slot.timer = setTimeout(failed, startupMs);
      slot.port.onerror = event => { event.preventDefault(); failed(); };
      slot.port.onmessageerror = failed;
      slot.port.onmessage = ({ data }) => {
        const message = data as { type?: unknown; hex?: unknown } | null;
        if (message?.type !== 'ready' || message.hex !== EMPTY_SHA256) { failed(); return; }
        clearTimeout(slot.timer); pendingStartup.delete(failed); resolve();
      };
    })));
  } catch {
    close();
    return nativeHashService();
  }
  for (const slot of slots) {
    slot.port.onerror = event => { event.preventDefault(); close(); };
    slot.port.onmessageerror = () => close();
    slot.port.onmessage = ({ data }) => {
      const message = data as { id?: unknown; hex?: unknown; computeMs?: unknown } | null;
      const job = slot.job;
      if (!job || message?.id !== job.id || typeof message.hex !== 'string'
        || !/^[a-f0-9]{64}$/.test(message.hex) || typeof message.computeMs !== 'number'
        || !Number.isFinite(message.computeMs) || message.computeMs < 0) { close(); return; }
      clearTimeout(slot.timer); slot.job = undefined;
      job.resolve({ hex: message.hex, computeMs: message.computeMs, backend: 'worker' });
      drain();
    };
  }
  return {
    digest(buffer) {
      if (failure) return Promise.reject(failure);
      return new Promise<HashResult>((resolve, reject) => {
        queue.push({ id: ++nextId, buffer, resolve, reject }); drain();
      });
    },
    dispose() { close(new Error('内容校验已结束，请重新扫描。')); },
  };
}
