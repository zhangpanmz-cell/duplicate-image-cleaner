import { nativeHashService } from './sha256-pool';
import { equalBytes } from './exact-bytes';

const hasher = nativeHashService();
// An empty-input known-vector handshake catches unavailable crypto before any
// picture buffer is transferred. This worker never receives file access handles.
hasher.digest(new ArrayBuffer(0)).then(result => {
  const a = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  if (!equalBytes(a, a.slice(0)) || equalBytes(a, new Uint8Array([1, 2, 3, 4, 6]).buffer)
    || equalBytes(a, new Uint8Array([0, 2, 3, 4, 5]).buffer) || equalBytes(a, new ArrayBuffer(4))) throw new Error('Byte self-test failed');
  self.postMessage({ type: 'ready', hex: result.hex, exact: true });
}).catch(() => self.postMessage({ type: 'unavailable' }));
self.onmessage = async ({ data }: MessageEvent<{ id: number; buffer: ArrayBuffer; copy?: ArrayBuffer }>) => {
  try {
    const result = data.copy ? await hasher.compareExact!(data.buffer, data.copy) : await hasher.digest(data.buffer);
    self.postMessage({ id: data.id, ...result });
  } catch {
    self.postMessage({ id: data.id, error: 'hash-failed' });
  }
};
