import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  server: { host: '127.0.0.1', port: 5299, strictPort: true },
  build: { outDir: 'node_modules/.cache/hash-benchmark', rolldownOptions: { input: resolve('tests/hash-benchmark.html') } },
});
