import NativeWorker from './sha256.worker?worker&inline';
import WasmWorker from './sha256-wasm-diagnostic.worker?worker&inline';
import { createHashPool } from './sha256-pool';
import type { DiagnosticCase } from './hash-diagnostics';

export const diagnosticService = (test: DiagnosticCase) => createHashPool(
  () => test.engine === 'wasm' ? new WasmWorker() : new NativeWorker(), test.threads, 5000, 15000,
);
