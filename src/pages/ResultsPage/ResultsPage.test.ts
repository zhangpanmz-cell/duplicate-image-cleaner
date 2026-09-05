import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { ISimilarGroup, SimilarityLevel } from '@/data/similarity';
import { useScanSession } from '@/hooks/useScanSession';
import { createInitialProgress } from '@/lib/scan-engine';
import ResultsPage from './ResultsPage';

vi.mock('@/hooks/useScanSession', () => ({ useScanSession: vi.fn() }));

function makeGroup(level: SimilarityLevel, index: number): ISimilarGroup {
  return {
    id: `group-${index}`,
    level,
    totalSize: 2048,
    reclaimableSize: level === 'exact' ? 1024 : 0,
    files: [0, 1].map((fileIndex) => ({
      id: `${index}-${fileIndex}`,
      name: `${index}-${fileIndex}.png`,
      relativePath: `pictures/${index}-${fileIndex}.png`,
      directory: 'pictures',
      size: 1024,
      width: 100,
      height: 100,
      hash: level === 'exact' ? 'same-content' : '',
      phash: '',
      dhash: '',
      distance: 0,
      level,
      thumbnailUrl: `blob:test-${index}-${fileIndex}`,
      selected: level === 'exact' && fileIndex === 1,
      isKept: level !== 'exact' || fileIndex === 0,
      source: 'scan',
    })),
  };
}

it.each([false, true])('结果页移除冗余说明，同时保留统计、分类和权限控制（删除可用：%s）', (canDeleteFiles) => {
  const groups = (['exact', 'high', 'high', 'high'] as const).map(makeGroup);
  const original = structuredClone(groups);
  vi.mocked(useScanSession).mockReturnValue({
    canDeleteFiles, isDeleting: false, deletionInterrupted: false,
    deletionProgress: { completed: 0, total: 0, currentFile: '' }, cancelDeletion: vi.fn(), deleteSelected: vi.fn(async () => true),
    status: 'done', source: canDeleteFiles ? 'directory' : 'files', groups,
    progress: createInitialProgress(), cleanSummary: null, errorMessage: '',
    toggleFile: vi.fn(() => true), selectAllCopies: vi.fn(), deselectAllCopies: vi.fn(),
    cleanSelected: vi.fn(() => true), cancelScan: vi.fn(), resetSession: vi.fn(), startScan: vi.fn(),
  });
  const markup = renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ResultsPage)),
  );
  const plainText = (html: string) => html.replace(/<[^>]*>/g, '').trim();
  const heading = markup.match(/<h1[^>]*>([\s\S]*?)<\/h1>([\s\S]*?)<button/);

  expect(heading).not.toBeNull();
  expect(plainText(heading![1])).toBe('发现 4 组重复与相似图片');
  expect(plainText(heading![2])).toBe('');
  expect(markup).not.toContain('完全重复默认保留一份并预选副本，相似组默认全部保留');
  expect(markup).not.toContain('真实删除已可用');
  expect(markup).not.toContain('仅在你核对清单、输入确认文字并允许目录写入后执行');
  expect(markup).toContain('可能存在误报');
  const deleteButton = markup.match(/<button\b([^>]*)>(?:(?!<\/button>)[\s\S])*?删除文件<\/button>/);
  expect(deleteButton).not.toBeNull();
  if (canDeleteFiles) {
    expect(markup).not.toContain('<div class="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">');
    expect(markup).not.toContain('当前结果没有有效的目录删除授权');
    expect(deleteButton![1]).not.toMatch(/\sdisabled(?:=|\s|$)/);
  } else {
    expect(markup).toContain('当前结果没有有效的目录删除授权，仅供查看');
    expect(markup).toContain('返回首页重新扫描');
    expect(deleteButton![1]).toMatch(/\sdisabled(?:=|\s|$)/);
  }
  expect(markup).toContain('返回首页');
  for (const label of ['完全重复组', '高度相似组', '疑似相似组', '涉及文件', '预计可释放']) {
    expect(markup).toContain(label);
  }
  const tabs = [...markup.matchAll(/<button\b[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => plainText(match[1]));
  expect(tabs).toEqual(['全部（4）', '完全重复（1）', '高度相似（3）', '疑似相似（0）']);
  expect(markup).toContain('pt-2 md:pt-6');
  expect(groups).toEqual(original);
});
