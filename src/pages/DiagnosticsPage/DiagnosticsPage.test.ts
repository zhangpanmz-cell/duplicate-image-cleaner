// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runHashDiagnostics } from '@/lib/hash-diagnostics';
import DiagnosticsPage from './DiagnosticsPage';

vi.mock('@/lib/hash-diagnostics', () => ({ runHashDiagnostics: vi.fn() }));
vi.mock('@/lib/hash-diagnostics-browser', () => ({ diagnosticService: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
const forbidden = vi.fn(() => { throw new Error('Diagnostics must not touch files or storage'); });
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('showDirectoryPicker', forbidden); vi.stubGlobal('showOpenFilePicker', forbidden);
  vi.stubGlobal('indexedDB', { open: forbidden });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(forbidden);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(forbidden);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(createElement(MemoryRouter, {
    basename: '/app/app_17df5ghxcy7', initialEntries: ['/app/app_17df5ghxcy7/diagnostics'],
  }, createElement(DiagnosticsPage))); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove();
  expect(forbidden).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
async function start() {
  await act(async () => { button('开始自检').click(); });
  for (let i = 0; i < 50 && !vi.mocked(runHashDiagnostics).mock.calls.length; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
  }
  expect(runHashDiagnostics).toHaveBeenCalledOnce();
}

it('shows the actual browser and a correctly based home link without starting work on mount', () => {
  expect(host.textContent).toContain(navigator.userAgent);
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/app/app_17df5ghxcy7');
  expect(host.textContent).toContain('不选择、不读取、不删除照片');
  expect(runHashDiagnostics).not.toHaveBeenCalled();
  expect(host.querySelector('input[type="file"]')).toBeNull();
});

it('renders verified results and re-enables the start button after completion', async () => {
  vi.mocked(runHashDiagnostics).mockImplementation(async (_factory, _signal, report) => {
    const rows = [{ engine: 'native' as const, threads: 1, round: 1, label: '原生计算 · 单线程',
      status: 'passed' as const, seconds: 0.5, mibPerSecond: 64 }];
    report('已完成', rows); return rows;
  });
  await start();
  expect(host.textContent).toContain('0.500 秒'); expect(host.textContent).toContain('64.0 MiB/s');
  expect(host.textContent).toContain('指纹一致'); expect(host.textContent).toContain('自检完成');
  expect(button('开始自检').disabled).toBe(false);
});

it.each(['stop', 'hidden', 'unmount'] as const)('cancels the current run on %s without starting another', async reason => {
  let signal: AbortSignal;
  vi.mocked(runHashDiagnostics).mockImplementation((_factory, current) => {
    signal = current;
    return new Promise((_resolve, reject) => current.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError'))));
  });
  await start(); expect(button('自检中…').disabled).toBe(true);
  await act(async () => {
    if (reason === 'stop') button('停止自检').click();
    if (reason === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
    }
    if (reason === 'unmount') root.render(createElement('div', null, '已离开'));
  });
  expect(signal!.aborted).toBe(true); expect(runHashDiagnostics).toHaveBeenCalledOnce();
  if (reason !== 'unmount') expect(host.textContent).toContain('自检已停止');
});
