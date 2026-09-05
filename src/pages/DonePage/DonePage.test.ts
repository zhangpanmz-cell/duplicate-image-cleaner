import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';
import type { ICleanSummary } from '@/data/done-page';
import DonePage from './DonePage';

let summary: ICleanSummary | null = null;
vi.mock('@/hooks/useScanSession', () => ({ useScanSession: () => ({ cleanSummary: summary }) }));
const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DonePage)));
it('separates actual failures and cancellation reasons from successful deletions', () => {
  summary = { mode: 'permanent', source: 'scan', cleanedCount: 1, cleanedBytes: 3,
    cleanedGroups: 1, remainingGroups: 1, results: [
      { id: '1', path: 'synthetic/success.png', size: 3, status: 'deleted', message: '' },
      { id: '2', path: 'synthetic/changed.png', size: 3, status: 'failed', message: '文件内容已变化，未删除' },
      { id: '3', path: 'synthetic/cancelled.png', size: 3, status: 'cancelled', message: '用户已停止' },
    ] };
  const dom = new JSDOM(render());
  const section = [...dom.window.document.querySelectorAll('h2')].find(h => h.textContent === '未删除文件及原因')!.parentElement!;
  expect(section.textContent).toContain('文件内容已变化，未删除');
  expect(section.textContent).toContain('用户已停止');
  expect(section.textContent).not.toContain('success.png');
  expect(section.querySelectorAll('li')).toHaveLength(2);
  expect(dom.window.document.body.textContent).toContain('性能自检（不操作文件）');
  dom.window.close();
});
it('does not invent failures for a simulation or after a refresh', () => {
  summary = { mode: 'simulation', source: 'mock', cleanedCount: 1, cleanedBytes: 3, cleanedGroups: 1, remainingGroups: 0 };
  expect(render()).not.toContain('未删除文件及原因');
  expect(render()).not.toContain('性能自检（不操作文件）');
  summary = null; expect(render()).toContain('暂无清理结果');
});
it('distinguishes full SHA checks from complete copy byte comparisons', () => {
  summary = { mode: 'permanent', source: 'scan', cleanedCount: 195, cleanedBytes: 1234,
    cleanedGroups: 13, remainingGroups: 0, metrics: {
      elapsedMs: 1000, authorizationMs: 0, permissionMs: 0, metadataMs: 0, readMs: 0,
      hashMs: 500, deleteMs: 0, verifiedFiles: 390, verifiedBytes: 2468, deleteCalls: 195,
      peakChecks: 4, peakDeletes: 4, peakInputBytes: 48 * 1024 * 1024,
      workerHashFiles: 195, mainHashFiles: 0, hashComputeMs: 400, byteComparedFiles: 195, byteCompareMs: 100,
    } };
  const dom = new JSDOM(render());
  const values = new Map([...dom.window.document.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling?.textContent]));
  expect(values.get('完整校验次数')).toContain('390');
  expect(values.get('完整指纹计算')).toBe('195 次');
  expect(values.get('副本完整字节比较')).toBe('195 次');
  expect(values.get('字节比较累计用时')).toBe('0.10 秒');
  dom.window.close();
});
