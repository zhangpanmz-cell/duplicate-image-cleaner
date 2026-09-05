import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ISimilarGroup, SimilarityLevel } from '@/data/similarity';
import GroupCardList from './GroupCardList';

function makeGroup(level: SimilarityLevel): ISimilarGroup {
  return {
    id: level,
    level,
    totalSize: 2048,
    reclaimableSize: level === 'exact' ? 1024 : 0,
    files: [0, 1].map((index) => ({
      id: `${level}-${index}`,
      name: `${index}.png`,
      relativePath: `pictures/${index}.png`,
      directory: 'pictures',
      size: 1024,
      width: 100,
      height: 100,
      hash: level === 'exact' ? 'same-content' : '',
      phash: '',
      dhash: '',
      distance: level === 'suspected' ? 8 : 0,
      level,
      thumbnailUrl: `blob:test-${level}-${index}`,
      selected: level === 'exact' && index === 1,
      isKept: level !== 'exact' || index === 0,
      source: 'scan',
    })),
  };
}

describe('图片组分类徽标', () => {
  it.each([
    ['exact', ['完全一致', '保留', '副本']],
    ['high', ['高度相似']],
    ['suspected', ['疑似相似']],
  ] as const)('%s 仅显示用户可读标签，不附带技术名称', (level, labels) => {
    const group = makeGroup(level);
    const original = structuredClone(group);
    const onToggleFile = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(GroupCardList, { groups: [group], onToggleFile }),
    );
    const badges = [...markup.matchAll(/<div class="whitespace-nowrap[^"]*">([\s\S]*?)<\/div>/g)]
      .map((match) => match[1].replace(/<[^>]*>/g, '').trim());

    expect(badges).toEqual(labels);
    expect(badges.join(' ')).not.toMatch(/SHA-256|pHash|dHash|汉明距离/);
    expect(group).toEqual(original);
    expect(onToggleFile).not.toHaveBeenCalled();
  });
});

describe('待删除文件的选中提示', () => {
  it.each(['exact', 'high', 'suspected'] as const)('%s 文件复选框使用醒目红色和更大的尺寸', (level) => {
    const markup = renderToStaticMarkup(
      createElement(GroupCardList, { groups: [makeGroup(level)], onToggleFile: vi.fn() }),
    );
    const checkboxes = [...markup.matchAll(/<button\b[^>]*role="checkbox"[^>]*>/g)]
      .map((match) => match[0]);

    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) {
      expect(checkbox).toContain('size-5');
      expect(checkbox).toContain('data-[state=checked]:bg-destructive');
      expect(checkbox).toContain('data-[state=checked]:text-destructive-foreground');
      expect(checkbox).not.toContain('data-[state=checked]:bg-primary');
    }
  });

  it.each(['exact', 'high', 'suspected'] as const)('%s 组仅在有勾选时显示准确的待删除数量', (level) => {
    const baseGroup = makeGroup(level);
    const onToggleFile = vi.fn();

    // 包括全未选、部分选中和重新取消，标记始终由当前文件选择计算。
    for (const count of [0, 1, 2, 0]) {
      const group = {
        ...baseGroup,
        files: baseGroup.files.map((file, index) => ({ ...file, selected: index < count })),
      };
      const original = structuredClone(group);
      const markup = renderToStaticMarkup(
        createElement(GroupCardList, { groups: [group], onToggleFile }),
      );

      if (count === 0) {
        expect(markup).not.toContain('role="status"');
        expect(markup).not.toContain('个待删除');
        expect(markup).not.toContain('border-destructive/40');
      } else {
        expect(markup.match(/role="status"/g)).toHaveLength(1);
        expect(markup).toContain(`aria-label="本组已勾选 ${count} 个待删除文件"`);
        expect(markup).toContain(`已勾选 · ${count} 个待删除`);
        expect(markup).toContain('border-destructive/40');
      }
      expect(group).toEqual(original);
    }

    expect(onToggleFile).not.toHaveBeenCalled();
  });

  it('标记按选中文件数而非文件大小判断，零字节文件也能显示', () => {
    const group = makeGroup('exact');
    group.files = group.files.map((file) => ({ ...file, size: 0 }));
    const markup = renderToStaticMarkup(
      createElement(GroupCardList, { groups: [group], onToggleFile: vi.fn() }),
    );

    expect(markup).toContain('aria-label="本组已勾选 1 个待删除文件"');
  });

  it('各组独立显示，未选的相似组不自动勾选', () => {
    const groups = [makeGroup('exact'), makeGroup('high'), makeGroup('suspected')];
    const original = structuredClone(groups);
    const onToggleFile = vi.fn();
    const markup = renderToStaticMarkup(createElement(GroupCardList, { groups, onToggleFile }));

    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(markup.match(/role="checkbox"/g)).toHaveLength(6);
    expect(groups).toEqual(original);
    expect(onToggleFile).not.toHaveBeenCalled();
  });
});
