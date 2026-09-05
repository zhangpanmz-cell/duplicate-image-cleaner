import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Layout } from '@/components/Layout';
import ResultsPage from '@/pages/ResultsPage/ResultsPage';
import HomePage from './HomePage';

vi.mock('@lark-apaas/client-toolkit-lite', () => ({
  logger: { error: vi.fn() },
}));

function renderPage(pathname = '/', basename = '/') {
  const prefix = basename === '/' ? '' : basename;
  return renderToStaticMarkup(
    createElement(MemoryRouter, { basename, initialEntries: [prefix + pathname] },
      createElement(Routes, null,
        createElement(Route, { path: '/', element: createElement(Layout) },
          createElement(Route, { index: true, element: createElement(HomePage) }),
          createElement(Route, { path: 'results', element: createElement(ResultsPage) }),
          createElement(Route, { path: 'scanning', element: createElement('div', null, '扫描页') }),
          createElement(Route, { path: 'done', element: createElement('div', null, '完成页') }),
        ),
      ),
    ),
  );
}

describe('首页和结果页文案精简', () => {
  it.each(['/', '/app/app_17df5ghxcy7'])('在 %s 基路径下使用新副标题并移除指定文案', (basename) => {
    const markup = renderPage('/', basename);
    expect(markup).toContain('找出磁盘中内容相同或相似图片');
    expect(markup).not.toContain('找出磁盘中内容完全相同的图片副本');
    expect(markup).not.toContain('完全重复：大小分组 + SHA-256 精确比对');
    expect(markup).not.toContain('图片不会上传');
    expect(markup).not.toContain('继续查看结果');
    expect(markup).not.toContain('网页版真实删除需使用支持目录授权的浏览器');
    expect(markup).not.toContain('删除前会单独申请写入权限');
    expect(markup).not.toContain('多选图片与不支持授权的浏览器仅可扫描查看');
  });

  it('保留品牌返回链接、三个扫描入口和两个本地文件输入', () => {
    const markup = renderPage();
    expect(markup).toContain('aria-label="重复图片清理器，点击返回首页"');
    expect(markup).toContain('选择文件夹并扫描');
    expect(markup).toContain('选择多张图片体验');
    expect(markup).toContain('加载演示数据');
    expect(markup.match(/type="file"/g)).toHaveLength(2);
  });

  it.each(['/', '/results'])('%s 不再显示多任务入口或编号', (pathname) => {
    const markup = renderPage(pathname);
    expect(markup).not.toContain('新建任务');
    expect(markup).not.toContain('每个标签页是独立任务');
    expect(markup).not.toContain('target="_blank"');
    expect(markup).not.toContain('任务编号');
  });

  it.each([
    ['/results', '/'],
    ['/results/', '/'],
    ['/results', '/app/app_17df5ghxcy7'],
    ['/results/', '/app/app_17df5ghxcy7'],
  ])('结果页 %s 在 %s 基路径下移除全部上传提示', (pathname, basename) => {
    const markup = renderPage(pathname, basename);
    expect(markup).not.toContain('图片不会上传');
    expect(markup).toContain('暂无扫描结果');
    expect(markup).toContain('刷新或关闭页面后不会保存');
    expect(markup).not.toContain('刷新后可继续查看');
    expect(markup).not.toContain('清除结果');
    expect(markup).toContain('返回首页重新扫描');
    expect(markup).toContain('加载演示数据');
  });

  it.each(['/scanning', '/done'])('不改变 %s 页面的公共隐私提示', (pathname) => {
    const markup = renderPage(pathname);
    expect(markup.match(/图片不会上传/g)).toHaveLength(2);
  });
});
