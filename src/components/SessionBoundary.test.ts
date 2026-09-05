import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useScanSession } from '@/hooks/useScanSession';
import { createInitialProgress } from '@/lib/scan-engine';
import SessionBoundary from './SessionBoundary';
import DonePage from '@/pages/DonePage/DonePage';

vi.mock('@/hooks/useScanSession', () => ({ useScanSession: vi.fn() }));

function render(overrides: Partial<ReturnType<typeof useScanSession>>, pathname = '/results') {
  vi.mocked(useScanSession).mockReturnValue({
    canDeleteFiles: false, isDeleting: false, deletionInterrupted: false,
    deletionProgress: { completed: 0, total: 0, currentFile: '' }, cancelDeletion: vi.fn(), deleteSelected: vi.fn(async () => true),
    status: 'idle', source: null, groups: [], progress: createInitialProgress(),
    cleanSummary: null, errorMessage: '',
    toggleFile: vi.fn(() => true), selectAllCopies: vi.fn(), deselectAllCopies: vi.fn(),
    cleanSelected: vi.fn(() => true), cancelScan: vi.fn(), resetSession: vi.fn(), startScan: vi.fn(),
    ...overrides,
  });
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [pathname] },
    createElement(SessionBoundary, null, createElement('p', null, '结果页面正文'))));
}

describe('仅内存会话界面', () => {
  it.each(['idle', 'scanning', 'done'] as const)('%s 不显示缓存或恢复界面', (status) => {
    const markup = render({ status });
    expect(markup).toContain('结果页面正文');
    for (const text of ['缓存', '清除结果', '重试保存', '已保存在本机', '正在恢复']) {
      expect(markup).not.toContain(text);
    }
  });
  it.each(['idle', 'done'] as const)('%s 返回首页也不显示继续查看入口或占位容器', (status) => {
    const markup = render({ status }, '/');
    expect(markup).not.toContain('继续查看结果');
    expect(markup).not.toContain('justify-end');
    expect(markup).toContain('结果页面正文');
  });
  it('保留删除进度、退出风险提示和停止按钮，删除中不挂载扫描页面', () => {
    const markup = render({ isDeleting: true, deletionProgress: { completed: 1, total: 3, currentFile: '照片/1.png' } });
    expect(markup).toContain('正在核验并删除文件');
    expect(markup).toContain('1 / 3');
    expect(markup).toContain('照片/1.png');
    expect(markup).toContain('请勿关闭或刷新页面');
    expect(markup).toContain('停止后续删除');
    expect(markup).not.toContain('结果页面正文');
  });
  it('当前页面删除异常后提示重新扫描，不提供恢复或重试删除', () => {
    const markup = render({ deletionInterrupted: true });
    expect(markup).toContain('部分文件可能已删除');
    expect(markup).toContain('不会自动重试');
    expect(markup).not.toContain('缓存');
  });
  it('分别显示等待授权和运行中的校验、删除数量', () => {
    const waiting = render({ isDeleting: true, deletionProgress: {
      completed: 0, total: 250, currentFile: '等待目录写入授权…', phase: 'authorizing',
    } });
    expect(waiting).toContain('等待目录写入授权');
    const working = render({ isDeleting: true, deletionProgress: {
      completed: 20, total: 250, currentFile: '照片/1.png', phase: 'working',
      activeChecks: 4, activeDeletes: 2, verifiedBytes: 1024 * 1024,
    } });
    expect(working).toContain('校验中 4 个 · 删除中 2 个');
    expect(working).toContain('已完整校验 1.0 MB 数据');
    expect(working).toContain('文件处理进度');
    expect(working).not.toContain('单个删除');
  });
  it('完成页只展示本次聚合计时，明确并发累计时间不能相加', () => {
    render({ cleanSummary: { source: 'scan', mode: 'permanent', cleanedCount: 250,
      cleanedBytes: 1024, cleanedGroups: 125, remainingGroups: 0,
      metrics: { elapsedMs: 8200, authorizationMs: 200, permissionMs: 500, metadataMs: 10000,
        readMs: 30, hashMs: 100, deleteMs: 2000, verifiedFiles: 500, verifiedBytes: 1024,
        deleteCalls: 250, peakChecks: 4, peakDeletes: 4, peakInputBytes: 1024 },
    } });
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DonePage)));
    expect(markup).toContain('本次用时 8.2 秒（含等待授权）');
    expect(markup).toContain('查看耗时明细');
    expect(markup).toContain('系统删除');
    expect(markup).toContain('不能相加当作实际用时');
    expect(markup).toContain('不保存或上传');
  });
});
