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
