import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import type { ISimilarGroup } from '@/data/similarity';
import { executeDeletion, fingerprint, type LocalDirectoryHandle, type LocalFileHandle } from '@/lib/file-deletion';
import { runScan } from '@/lib/scan-engine';
import { ScanSessionProvider, useScanSession } from './useScanSession';

vi.mock('@lark-apaas/client-toolkit-lite', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/scan-engine', async (original) => ({ ...await original<object>(), runScan: vi.fn() }));

vi.mock('@/lib/file-deletion', async (original) => {
  const actual = await original<typeof import('@/lib/file-deletion')>();
  return { ...actual, executeDeletion: vi.fn(actual.executeDeletion) };
});

let storageAccess: Mock<() => never>;
let dom: JSDOM;
let reactRoot: Root;
let session: ReturnType<typeof useScanSession>;
function Harness() {
  const value = useScanSession();
  useEffect(() => { session = value; });
  return createElement('div', null, value.status);
}
async function flushUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (predicate()) return;
  }
  throw new Error('React state did not settle');
}
async function mount() {
  reactRoot = createRoot(document.createElement('div'));
  await act(async () => { reactRoot.render(createElement(ScanSessionProvider, null, createElement(Harness))); });
}
beforeEach(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://cleaner.test' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_name, _options, work) => work({ name: 'delete' })) } });
  storageAccess = vi.fn(() => { throw new Error('Result persistence must not be accessed'); });
  vi.stubGlobal('indexedDB', { open: storageAccess, deleteDatabase: storageAccess });
  Object.defineProperty(dom.window, 'indexedDB', { value: globalThis.indexedDB });
  vi.spyOn(dom.window.Storage.prototype, 'getItem').mockImplementation(storageAccess);
  vi.spyOn(dom.window.Storage.prototype, 'setItem').mockImplementation(storageAccess);
  vi.spyOn(dom.window.Storage.prototype, 'removeItem').mockImplementation(storageAccess);
  vi.spyOn(dom.window.Storage.prototype, 'clear').mockImplementation(storageAccess);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await mount();
});
afterEach(async () => {
  await act(async () => { reactRoot.unmount(); });
  expect(storageAccess).not.toHaveBeenCalled();
  dom.window.close();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function scan(source: 'directory' | 'demo' | 'files' = 'directory') {
  const files = [0, 1, 2].map((i) => new File(['abc'], `${i}.png`, { lastModified: 123 }));
  const hash = await fingerprint(files[0]);
  const handles: LocalFileHandle[] = files.map((file) => ({ kind: 'file', name: file.name,
    getFile: vi.fn(async () => file), isSameEntry: vi.fn(async () => true) }));
  const directory: LocalDirectoryHandle = {
    kind: 'directory', name: 'photos', async *values() { yield* handles; },
    getFileHandle: vi.fn(async (name) => handles.find((handle) => handle.name === name)!),
    getDirectoryHandle: vi.fn(async () => directory), resolve: vi.fn(async (handle) => [handle.name]),
    requestPermission: vi.fn(async () => 'granted' as const), queryPermission: vi.fn(async () => 'granted' as const),
    removeEntry: vi.fn(async () => undefined),
  };
  const group: ISimilarGroup = { id: 'group', level: 'exact', totalSize: 9, reclaimableSize: 6,
    files: files.map((file, i) => ({ id: String(i), name: file.name, relativePath: `photos/${file.name}`,
      directory: 'photos', size: file.size, width: 10, height: 10, hash, phash: '', dhash: '',
      distance: 0, level: 'exact', thumbnailUrl: URL.createObjectURL(file),
      selected: i > 0, isKept: i === 0, source: source === 'demo' ? 'mock' : 'scan' })) };
  vi.mocked(runScan).mockResolvedValueOnce([group]);
  await act(async () => {
    session.startScan({ source, directoryHandle: source === 'directory' ? directory : undefined,
      collect: async () => files.map((file, i) => ({ file, handle: handles[i], relativePath: `photos/${file.name}` })) });
  });
  await flushUntil(() => session.status === 'done');
  return { directory, group };
}

it('requests permission on the click and counts only successful file deletions', async () => {
  const { directory } = await scan();
  const actualRemove = vi.mocked(directory.removeEntry);
  actualRemove.mockImplementation(async (name) => {
    if (name === '2.png') throw new Error('测试占用');
  });
  await act(async () => { expect(await session.deleteSelected(['group'], ['1', '2'], '删除')).toBe(true); });
  expect(directory.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  expect(session.cleanSummary?.cleanedCount).toBe(1);
  expect(session.cleanSummary?.cleanedBytes).toBe(3);
  expect(session.cleanSummary?.mode).toBe('permanent');
  expect(session.cleanSummary?.metrics?.deleteCalls).toBe(2);
  expect(session.cleanSummary?.metrics?.verifiedFiles).toBe(4);
  expect(session.cleanSummary?.metrics?.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(session.cleanSummary?.metrics?.authorizationMs).toBeGreaterThanOrEqual(0);
  expect(session.groups[0].files.map((file) => file.id)).toEqual(['0', '2']);
  expect(session.groups[0].files[1].selected).toBe(true);
  expect(storageAccess).not.toHaveBeenCalled();
});

it('rejects missing confirmation before requesting permissions', async () => {
  const { directory } = await scan();
  await expect(session.deleteSelected(['group'], ['1', '2'], '')).rejects.toThrow('请输入');
  expect(directory.requestPermission).not.toHaveBeenCalled();
  expect(directory.removeEntry).not.toHaveBeenCalled();
});

it('permission denial leaves the files and selection intact', async () => {
  const { directory, group } = await scan();
  directory.requestPermission = vi.fn(async () => 'denied' as const);
  await act(async () => { await expect(session.deleteSelected(['group'], ['1', '2'], '删除')).rejects.toThrow('没有删除'); });
  expect(directory.removeEntry).not.toHaveBeenCalled();
  expect(session.groups).toEqual([group]);
  expect(session.isDeleting).toBe(false);
});

it('scanning and deletion no longer depend on browser storage availability', async () => {
  const { directory } = await scan();
  await act(async () => { expect(await session.deleteSelected(['group'], ['1', '2'], '删除')).toBe(true); });
  expect(directory.removeEntry).toHaveBeenCalledTimes(2);
  expect(session.cleanSummary?.cleanedCount).toBe(2);
  expect(storageAccess).not.toHaveBeenCalled();
});

it('locks double submission, selection, clearing and rescanning while awaiting permission', async () => {
  const { directory } = await scan();
  let grant!: (value: PermissionState) => void;
  directory.requestPermission = vi.fn(() => new Promise<PermissionState>((resolve) => { grant = resolve; }));
  let task!: Promise<boolean>;
  await act(async () => { task = session.deleteSelected(['group'], ['1', '2'], '删除'); });
  expect(session.isDeleting).toBe(true);
  expect(await session.deleteSelected(['group'], ['1', '2'], '删除')).toBe(false);
  expect(session.toggleFile('group', '1')).toBe(false);
  session.resetSession();
  expect(session.groups[0].files).toHaveLength(3);
  const collector = vi.fn();
  session.startScan({ source: 'files', collect: collector });
  expect(collector).not.toHaveBeenCalled();
  await act(async () => { session.cancelDeletion(); grant('granted'); await task; });
  expect(directory.removeEntry).not.toHaveBeenCalled();
});

it('refresh/remount starts empty, revokes previews and never restores old files or deletion capabilities', async () => {
  const { directory, group } = await scan();
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  await act(async () => { reactRoot.unmount(); });
  for (const file of group.files) expect(revoke).toHaveBeenCalledWith(file.thumbnailUrl);
  await mount();
  expect(session.status).toBe('idle');
  expect(session.source).toBeNull();
  expect(session.groups).toHaveLength(0);
  expect(session.cleanSummary).toBeNull();
  expect(session.canDeleteFiles).toBe(false);
  await expect(session.deleteSelected(['group'], ['1', '2'], '删除')).rejects.toThrow('重新扫描');
  expect(directory.removeEntry).not.toHaveBeenCalled();
});

it('page exit cancels pending authorization; a later grant cannot start deletion', async () => {
  const { directory } = await scan();
  let grant!: (value: PermissionState) => void;
  directory.requestPermission = vi.fn(() => new Promise<PermissionState>((resolve) => { grant = resolve; }));
  let task!: Promise<boolean>;
  await act(async () => { task = session.deleteSelected(['group'], ['1', '2'], '删除'); });
  const warning = new dom.window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(warning);
  expect(warning.defaultPrevented).toBe(true);
  await act(async () => { window.dispatchEvent(new dom.window.Event('pagehide')); });
  expect(session.groups).toHaveLength(0);
  expect(session.canDeleteFiles).toBe(false);
  expect(session.isDeleting).toBe(false);
  await act(async () => { grant('granted'); await task; });
  expect(directory.removeEntry).not.toHaveBeenCalled();
  expect(session.cleanSummary).toBeNull();
  expect(session.status).toBe('idle');
});

it('an unexpected execution failure disables further deletion and requires a new scan', async () => {
  const { directory } = await scan();
  vi.mocked(executeDeletion).mockRejectedValueOnce(new Error('Unexpected interruption'));
  await act(async () => { await expect(session.deleteSelected(['group'], ['1', '2'], '删除')).rejects.toThrow('Unexpected interruption'); });
  expect(session.deletionInterrupted).toBe(true);
  expect(session.canDeleteFiles).toBe(false);
  expect(session.isDeleting).toBe(false);
  await expect(session.deleteSelected(['group'], ['1', '2'], '删除')).rejects.toThrow('重新扫描');
  expect(directory.removeEntry).not.toHaveBeenCalled();
});

it.each(['files', 'demo'] as const)('%s cannot call permanent deletion', async (source) => {
  const { directory } = await scan(source);
  await expect(session.deleteSelected(['group'], ['1', '2'], '删除')).rejects.toThrow('没有有效');
  expect(directory.removeEntry).not.toHaveBeenCalled();
  await act(async () => { expect(session.cleanSelected(['group'])).toBe(source === 'demo'); });
});

it('a competing deletion lock blocks execution before any filesystem mutations', async () => {
  const { directory } = await scan();
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, work: (lock: null) => unknown) => work(null) } });
  await act(async () => { await expect(session.deleteSelected(['group'], ['1', '2'], '删除')).rejects.toThrow('另一个页面'); });
  expect(directory.removeEntry).not.toHaveBeenCalled();
});

it('selection and simulation remain usable in memory, but their summary is gone after refresh', async () => {
  await scan('demo');
  await act(async () => { session.deselectAllCopies(['group']); });
  expect(session.groups[0].files.filter((file) => file.selected)).toHaveLength(0);
  await act(async () => { session.toggleFile('group', '1'); });
  expect(session.groups[0].files.filter((file) => file.selected)).toHaveLength(1);
  await act(async () => { expect(session.cleanSelected(['group'])).toBe(true); });
  expect(session.cleanSummary?.cleanedCount).toBe(1);
  expect(session.groups[0].files.map((file) => file.id)).toEqual(['0', '2']);
  await act(async () => { reactRoot.render(createElement(ScanSessionProvider, null, createElement(Harness))); });
  expect(session.cleanSummary?.cleanedCount).toBe(1);
  await act(async () => { reactRoot.unmount(); });
  await mount();
  expect(session.groups).toHaveLength(0);
  expect(session.cleanSummary).toBeNull();
});

it('page exit during a file removal allows that operation to finish but stops all following files', async () => {
  const { directory } = await scan();
  let finish!: () => void;
  directory.removeEntry = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  let task!: Promise<boolean>;
  await act(async () => { task = session.deleteSelected(['group'], ['1', '2'], '删除'); });
  await flushUntil(() => !!finish);
  await act(async () => { window.dispatchEvent(new dom.window.Event('pagehide')); });
  await act(async () => { finish(); expect(await task).toBe(false); });
  expect(directory.removeEntry).toHaveBeenCalledTimes(1);
  expect(session.status).toBe('idle');
  expect(session.groups).toHaveLength(0);
  expect(session.cleanSummary).toBeNull();
});

it('leaving while collecting cancels old scan callbacks and prevents results returning on back navigation', async () => {
  let finish!: (files: []) => void;
  await act(async () => {
    session.startScan({ source: 'demo', collect: () => new Promise<[]>((resolve) => { finish = resolve; }) });
  });
  expect(session.status).toBe('scanning');
  const calls = vi.mocked(runScan).mock.calls.length;
  await act(async () => { window.dispatchEvent(new dom.window.Event('pagehide')); });
  await act(async () => { finish([]); });
  expect(vi.mocked(runScan).mock.calls).toHaveLength(calls);
  expect(session.status).toBe('idle');
  expect(session.source).toBeNull();
  expect(session.groups).toHaveLength(0);
});

it('a new scan replaces the in-memory result, and an empty completed scan is not an unstarted session', async () => {
  await scan('demo');
  vi.mocked(runScan).mockResolvedValueOnce([]);
  await act(async () => { session.startScan({ source: 'files', collect: async () => [] }); });
  await flushUntil(() => session.status === 'done');
  expect(session.groups).toHaveLength(0);
  expect(session.source).toBe('files');
  expect(session.cleanSummary).toBeNull();
  expect(session.canDeleteFiles).toBe(false);
  await act(async () => { session.resetSession(); });
  expect(session.status).toBe('idle');
  expect(session.source).toBeNull();
});
