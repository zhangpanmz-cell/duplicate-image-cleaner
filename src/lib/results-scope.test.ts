import { describe, expect, it } from 'vitest';
import type {
  ISimilarFileEntry,
  ISimilarGroup,
  SimilarityLevel,
} from '@/data/similarity';
import {
  applyDeselectAllToScope,
  applySelectAllToScope,
  computeClean,
  computeGroupCounts,
  filterVisibleGroups,
  SIMILARITY_LABEL,
  sortGroupsByMaxFileSize,
  statsForGroups,
} from '@/lib/results-scope';

// ── 测试夹具 ──────────────────────────────────────────────

function makeFile(
  id: string,
  overrides: Partial<ISimilarFileEntry> = {},
): ISimilarFileEntry {
  return {
    id,
    name: `${id}.jpg`,
    relativePath: `dir/${id}.jpg`,
    directory: 'dir-a',
    size: 1024,
    width: 100,
    height: 100,
    hash: 'hash',
    phash: '',
    dhash: '',
    distance: 0,
    level: 'exact',
    thumbnailUrl: `blob:${id}`,
    selected: false,
    isKept: true,
    source: 'mock',
    ...overrides,
  };
}

function makeGroup(
  id: string,
  level: SimilarityLevel,
  files: ISimilarFileEntry[],
): ISimilarGroup {
  return {
    id,
    level,
    files,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    reclaimableSize: files
      .filter((file) => file.selected)
      .reduce((sum, file) => sum + file.size, 0),
  };
}

/** 构造典型场景：2 个完全重复组 + 2 个相似组，分布在两个目录 */
function buildFixture(): ISimilarGroup[] {
  return [
    // g1：完全重复，3 份（默认保留第 1 份，预选其余 2 份）
    makeGroup('g1', 'exact', [
      makeFile('f1', { size: 4096 }),
      makeFile('f2', { size: 4096, selected: true, isKept: false }),
      makeFile('f3', { size: 4096, selected: true, isKept: false }),
    ]),
    // g2：完全重复，位于目录 B（未预选）
    makeGroup('g2', 'exact', [
      makeFile('f4', { directory: 'dir-b', size: 2048 }),
      makeFile('f5', { directory: 'dir-b', size: 2048 }),
    ]),
    // g3：高度相似，默认全部保留（不自动勾选）
    makeGroup('g3', 'high', [
      makeFile('f6', { directory: 'dir-b', size: 8192, level: 'high' }),
      makeFile('f7', { directory: 'dir-b', size: 8192, level: 'high' }),
    ]),
    // g4：疑似相似，默认全部保留
    makeGroup('g4', 'suspected', [
      makeFile('f8', { size: 512, level: 'suspected' }),
      makeFile('f9', { size: 512, level: 'suspected' }),
    ]),
  ];
}

// ── 1. 标签映射与计数 ─────────────────────────────────────

describe('标签映射与分类计数', () => {
  it('exact/high/suspected 映射到固定中文标签', () => {
    expect(SIMILARITY_LABEL.exact).toBe('完全重复');
    expect(SIMILARITY_LABEL.high).toBe('高度相似');
    expect(SIMILARITY_LABEL.suspected).toBe('疑似相似');
  });

  it('exact 0 / high 3 / suspected 0 场景下计数绑定真实数据', () => {
    const groups = [
      makeGroup('a', 'high', [
        makeFile('a1', { level: 'high' }),
        makeFile('a2', { level: 'high' }),
      ]),
      makeGroup('b', 'high', [
        makeFile('b1', { level: 'high' }),
        makeFile('b2', { level: 'high' }),
      ]),
      makeGroup('c', 'high', [
        makeFile('c1', { level: 'high' }),
        makeFile('c2', { level: 'high' }),
      ]),
    ];
    expect(computeGroupCounts(groups)).toMatchObject({
      exact: 0,
      high: 3,
      suspected: 0,
    });
  });

  it('统计文件总数、已勾选数与已勾选字节', () => {
    const counts = computeGroupCounts(buildFixture());
    expect(counts.fileCount).toBe(9);
    expect(counts.selectedCount).toBe(2);
    expect(counts.reclaimBytes).toBe(8192);
  });
});

// ── 2. 筛选 ───────────────────────────────────────────────

describe('分类与目录筛选', () => {
  it('按分类 tab 筛选', () => {
    const visible = filterVisibleGroups(buildFixture(), {
      level: 'exact',
      directory: 'all',
    });
    expect(visible.map((g) => g.id)).toEqual(['g1', 'g2']);
  });

  it('按目录筛选：组内任一文件命中即显示（组可跨目录）', () => {
    const visible = filterVisibleGroups(buildFixture(), {
      level: 'all',
      directory: 'dir-b',
    });
    expect(visible.map((g) => g.id)).toEqual(['g2', 'g3']);
  });

  it('all + all 显示全部', () => {
    const visible = filterVisibleGroups(buildFixture(), {
      level: 'all',
      directory: 'all',
    });
    expect(visible).toHaveLength(4);
  });
});

// ── 3. 批量操作范围化 ────────────────────────────────────

describe('批量操作仅作用于显式范围', () => {
  it('全选只作用于范围内完全重复组，隐藏组保持原状', () => {
    const groups = buildFixture();
    // 模拟当前显示范围 = 仅 g1（如按目录 dir-a 筛选）
    const scope = ['g1'];
    const next = applySelectAllToScope(groups, scope);

    const g1 = next[0];
    expect(g1.files.map((f) => f.selected)).toEqual([false, true, true]);
    expect(g1.files[0].isKept).toBe(true);

    // 隐藏的 g2 未被全选
    expect(next[1].files.every((f) => !f.selected)).toBe(true);
    // 隐藏的相似组不被自动勾选
    expect(next[2].files.every((f) => !f.selected)).toBe(true);
    expect(next[3].files.every((f) => !f.selected)).toBe(true);
  });

  it('取消全选只作用于范围内，隐藏组的已选状态保留', () => {
    const groups = buildFixture();
    // 先全选 g1 与 g2（g2 每组保留一份预选副本）
    const selected = applySelectAllToScope(groups, ['g1', 'g2']);
    // 当前显示范围只有 g1，取消全选
    const next = applyDeselectAllToScope(selected, ['g1']);

    expect(next[0].files.every((f) => !f.selected)).toBe(true);
    // 隐藏的 g2 勾选状态保留（默认保留一份 + 预选副本）
    expect(next[1].files.map((f) => f.selected)).toEqual([false, true]);
  });

  it('空范围（[]）代表无操作：全选 / 取消全选原样返回', () => {
    const groups = buildFixture();
    expect(applySelectAllToScope(groups, [])).toBe(groups);
    expect(applyDeselectAllToScope(groups, [])).toBe(groups);
  });

  it('全选不改变相似组：相似组默认无选中（不自动预选）', () => {
    const groups = [makeGroup('g3', 'high', [
      makeFile('f6', { level: 'high' }),
      makeFile('f7', { level: 'high' }),
    ])];
    const next = applySelectAllToScope(groups, ['g3']);
    expect(next[0].files.every((f) => !f.selected)).toBe(true);
    expect(statsForGroups(next)).toEqual({
      selectedCount: 0,
      reclaimBytes: 0,
    });
  });
});

// ── 4. 大文件优先排序 ────────────────────────────────────

describe('大文件优先排序（按组内最大单文件 size 降序）', () => {
  it('按组内最大单文件大小降序，相同大小组 ID 升序作次级排序', () => {
    const groups = [
      makeGroup('b', 'exact', [
        makeFile('x1', { size: 100 }),
        makeFile('x2', { size: 300 }),
      ]), // max 300
      makeGroup('a', 'exact', [makeFile('y1', { size: 300 })]),
      makeGroup('c', 'exact', [makeFile('z1', { size: 900 })]),
    ];
    const sorted = sortGroupsByMaxFileSize(groups);
    expect(sorted.map((g) => g.id)).toEqual(['c', 'a', 'b']);
  });

  it('勾选状态变化不影响排序（与选中状态无关，前后一致）', () => {
    const groups = [
      makeGroup('b', 'exact', [
        makeFile('x1', { size: 100 }),
        makeFile('x2', { size: 300 }),
      ]),
      makeGroup('a', 'exact', [
        makeFile('y1', { size: 200 }),
        makeFile('y2', { size: 200 }),
      ]),
      makeGroup('c', 'high', [
        makeFile('z1', { size: 50, level: 'high' }),
        makeFile('z2', { size: 400, level: 'high', selected: true }),
      ]),
    ];
    const before = sortGroupsByMaxFileSize(groups).map((g) => g.id);

    // 勾选状态全部翻转（reclaimableSize 随之变化），排序结果不变
    const toggled = groups.map((group) => ({
      ...group,
      files: group.files.map((file) => ({
        ...file,
        selected: !file.selected,
      })),
      reclaimableSize: group.files
        .filter((file) => !file.selected)
        .reduce((sum, file) => sum + file.size, 0),
    }));
    const after = sortGroupsByMaxFileSize(toggled).map((g) => g.id);

    expect(after).toEqual(before);
  });

  it('不修改入参数组顺序', () => {
    const groups = [
      makeGroup('b', 'exact', [makeFile('x1', { size: 300 })]),
      makeGroup('a', 'exact', [makeFile('y1', { size: 100 })]),
    ];
    sortGroupsByMaxFileSize(groups);
    expect(groups.map((g) => g.id)).toEqual(['b', 'a']);
  });
});

// ── 5. 范围化模拟清理 ────────────────────────────────────

describe('模拟清理仅处理当前显示范围', () => {
  it('空范围返回 null（不退化为全局清理）', () => {
    expect(computeClean(buildFixture(), [])).toBeNull();
  });

  it('范围外 ID 返回 null', () => {
    expect(computeClean(buildFixture(), ['not-exist'])).toBeNull();
  });

  it('只清理范围内组的勾选项，隐藏组的勾选状态原样保留', () => {
    const groups = buildFixture();
    // 隐藏的 g2 先手动勾选一份（模拟用户此前在「全部」视图的操作）
    const withHiddenSelected = groups.map((group) =>
      group.id === 'g2'
        ? {
            ...group,
            files: group.files.map((file, index) =>
              index === 1
                ? { ...file, selected: true, isKept: false }
                : file,
            ),
          }
        : group,
    );

    // 当前显示范围 = 仅 g1（g2 被目录筛选隐藏）
    const result = computeClean(withHiddenSelected, ['g1']);
    expect(result).not.toBeNull();

    // 只统计 g1 的 2 个预选副本
    expect(result?.cleanedCount).toBe(2);
    expect(result?.cleanedBytes).toBe(8192);
    expect(result?.cleanedGroups).toBe(1);

    // 隐藏的 g2 原样透传（含已勾选状态）
    const hidden = result?.remainingGroups.find((g) => g.id === 'g2');
    expect(hidden?.files.map((f) => f.selected)).toEqual([false, true]);
    // 相似组未勾选 → 原样保留
    expect(result?.remainingGroups.some((g) => g.id === 'g3')).toBe(true);
    // g1 仅剩 1 份 → 不再保留为组，缩略图一并回收
    expect(result?.remainingGroups.some((g) => g.id === 'g1')).toBe(false);
    expect(result?.revokeUrls).toContain('blob:f1');
    expect(result?.revokeUrls).toContain('blob:f3');
    // 隐藏组 / 相似组的缩略图不在本次回收范围
    expect(result?.revokeUrls).not.toContain('blob:f5');
    expect(result?.revokeUrls).not.toContain('blob:f6');
  });

  it('范围内勾选后仅剩 2 份的组保留（reclaimableSize 归零）', () => {
    const groups = [
      makeGroup('g1', 'exact', [
        makeFile('f1', { size: 100 }),
        makeFile('f2', { size: 100, selected: true, isKept: false }),
        makeFile('f3', { size: 100 }),
      ]),
    ];
    const result = computeClean(groups, ['g1']);
    const remaining = result?.remainingGroups[0];
    expect(remaining?.files).toHaveLength(2);
    expect(remaining?.reclaimableSize).toBe(0);
  });

  it('纯函数：不修改入参', () => {
    const groups = buildFixture();
    computeClean(groups, ['g1']);
    expect(groups[0].files.map((f) => f.selected)).toEqual([false, true, true]);
  });
});
