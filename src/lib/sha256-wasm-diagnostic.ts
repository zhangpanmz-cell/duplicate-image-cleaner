// Diagnostic candidate ONLY. The production deletion path still uses WebCrypto.
import { createSHA256 } from 'hash-wasm';
import type { HashService } from './sha256-pool';

export async function createWasmDiagnosticHasher(): Promise<HashService> {
  const hash = await createSHA256();
  let closed = false;
  return {
    async digest(buffer) {
      if (closed) throw new Error('自检已结束');
      const start = performance.now();
      const hex = hash.init().update(new Uint8Array(buffer)).digest('hex');
      return { hex, computeMs: performance.now() - start, backend: 'main' };
    },
    dispose() { closed = true; },
  };
}
