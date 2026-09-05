import { createWasmDiagnosticHasher } from './sha256-wasm-diagnostic';
// Receives synthetic buffers only, never directories, image files or permissions.
createWasmDiagnosticHasher().then(async hasher => {
  const empty = await hasher.digest(new ArrayBuffer(0));
  self.onmessage = async ({ data }: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
    try {
      const result = await hasher.digest(data.buffer);
      self.postMessage({ id: data.id, hex: result.hex, computeMs: result.computeMs });
    } catch { self.postMessage({ id: data.id, error: 'hash-failed' }); }
  };
  self.postMessage({ type: 'ready', hex: empty.hex });
}).catch(() => self.postMessage({ type: 'unavailable' }));
