// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ISimilarGroup, SimilarityLevel } from '@/data/similarity';
import PermanentDeleteDialog from './PermanentDeleteDialog';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals();
});
function button(text: string) {
  return [...document.querySelectorAll('button')].find((item) => item.textContent === text)!;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function type(text: string) {
  await act(async () => {
    const input = document.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function render(level: SimilarityLevel = 'exact', disabled = false, options: { selected?: boolean; onDelete?: () => Promise<void> } = {}) {
  const group: ISimilarGroup = { id: 'visible', level, files: [0, 1].map((i) => ({
    id: String(i), name: `${i}.png`, relativePath: `真实目录/子目录/${i}.png`, directory: '真实目录/子目录',
    size: 3, width: 10, height: 10, hash: '', phash: '', dhash: '', distance: 0,
    level, thumbnailUrl: '', selected: i === 1 && options.selected !== false, isKept: i === 0, source: 'scan',
  })), totalSize: 6, reclaimableSize: 3 };
  const onDelete = vi.fn(options.onDelete ?? (async () => undefined));
  await act(async () => { root.render(createElement(PermanentDeleteDialog, { groups: [group], disabled, hiddenCount: 7, onDelete })); });
  return onDelete;
}
function expectGrayConfirm() {
  expect(button('确认').disabled).toBe(false);
  expect(button('确认').getAttribute('aria-disabled')).toBe('true');
  expect(button('确认').classList.contains('bg-muted')).toBe(true);
}
function expectReadyConfirm() {
  expect(button('确认').disabled).toBe(false);
  expect(button('确认').getAttribute('aria-disabled')).toBe('false');
  expect(button('确认').classList.contains('bg-destructive')).toBe(true);
  expect(button('确认').classList.contains('bg-muted')).toBe(false);
}
it('highlights the no-recycle-bin warning, preserves the file scope, and explains a gray confirmation', async () => {
  const onDelete = await render();
  await click(button('删除文件'));
  expect(document.body.textContent).toContain('不进入系统回收站，无法撤销');
  const warning = document.querySelector('strong')!;
  expect(warning.textContent).toBe('不进入系统回收站');
  expect(warning.className).toContain('var(--destructive)');
  expect(document.body.textContent).not.toContain('永久删除');
  expect(document.body.textContent).toContain('真实目录/子目录/1.png');
  expect(document.body.textContent).not.toContain('真实目录/子目录/0.png');
  expect(document.body.textContent).toContain('隐藏组另有 7 个勾选项，不会删除');
  expectGrayConfirm();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await click(button('确认'));
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('请在输入框中准确输入“删除”两个字');
  expect(document.querySelector('[role="alert"]')!.className).toContain('var(--destructive)');
  expect(document.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
  expect(document.querySelector('input')!.getAttribute('aria-describedby')).toBe('delete-confirmation-error');
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
  await type('删'); expectGrayConfirm();
  await click(button('确认'));
  expect(onDelete).not.toHaveBeenCalled();
  await type('删除'); expectReadyConfirm();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('input')!.getAttribute('aria-invalid')).toBe('false');
  expect(onDelete).not.toHaveBeenCalled();
  await click(button('确认'));
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(['visible'], ['1'], '删除');
});
it.each(['high', 'suspected'] as const)('%s images require typed confirmation without the removed review checkbox', async (level) => {
  const onDelete = await render(level);
  await click(button('删除文件'));
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  expect(document.body.textContent).not.toContain('我已逐张放大核对相似图片');
  expect(document.body.textContent).not.toContain('相似图片可能包含独有内容');
  expectGrayConfirm();
  await click(button('确认'));
  expect(document.querySelectorAll('[role="alert"] li')).toHaveLength(1);
  expect(document.querySelector('#delete-confirmation-error')).not.toBeNull();
  expect(document.querySelector('#delete-review-error')).toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
  await type('删除');
  expectReadyConfirm();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
  // Removing a satisfied condition makes the button gray and blocks submission again.
  await type('');
  expectGrayConfirm();
  await click(button('确认'));
  expect(onDelete).not.toHaveBeenCalled();
  await type('删除');
  await click(button('确认'));
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(['visible'], ['1'], '删除');
});
it('cancelling and reopening clears validation and typed text', async () => {
  const onDelete = await render('suspected');
  await click(button('删除文件'));
  await type('删');
  await click(button('确认'));
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  await click(button('取消'));
  expect(onDelete).not.toHaveBeenCalled();
  await click(button('删除文件'));
  expectGrayConfirm();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('input')!.value).toBe('');
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
});
it.each(['删', '删除 ', ' 删除', '确认'])('does not accept inexact confirmation %j', async (text) => {
  const onDelete = await render();
  await click(button('删除文件')); await type(text);
  await click(button('确认'));
  expectGrayConfirm();
  expect(document.querySelector('#delete-confirmation-error')).not.toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
});
it('explains an empty deletion scope without calling the delete handler', async () => {
  const onDelete = await render('exact', false, { selected: false });
  await click(button('删除文件')); await type('删除');
  await click(button('确认'));
  expectGrayConfirm();
  expect(document.querySelector('#delete-selection-error')!.textContent).toContain('当前没有待删除文件');
  expect(onDelete).not.toHaveBeenCalled();
});
it('locks confirmation during submission and guards against same-tick double clicks', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const onDelete = await render('suspected', false, { onDelete: () => pending });
  await click(button('删除文件')); await type('删除');
  await act(async () => { button('确认').click(); button('确认').click(); });
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(button('确认').disabled).toBe(true);
  expect(button('取消').disabled).toBe(true);
  expect(document.querySelector('input')!.disabled).toBe(true);
  await click(button('确认'));
  expect(onDelete).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); await pending; });
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
it('read-only results cannot open a deletion dialog', async () => {
  const onDelete = await render('exact', true);
  expect(button('删除文件').disabled).toBe(true);
  await click(button('删除文件'));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(onDelete).not.toHaveBeenCalled();
});
