import { nativeHashService } from './sha256-pool';

const hasher = nativeHashService();
// An empty-input known-vector handshake catches unavailable crypto before any
// picture buffer is transferred. This worker never receives file access handles.
hasher.digest(new ArrayBuffer(0)).then(result => {
  self.postMessage({ type: 'ready', hex: result.hex });
}).catch(() => self.postMessage({ type: 'unavailable' }));
self.onmessage = async ({ data }: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
  try {
    const result = await hasher.digest(data.buffer);
    self.postMessage({ id: data.id, hex: result.hex, computeMs: result.computeMs });
  } catch {
    self.postMessage({ id: data.id, error: 'hash-failed' });
  }
};
