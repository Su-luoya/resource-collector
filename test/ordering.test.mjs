import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNewest, comparePinned, sortLinks } from '../src/lib/ordering.mjs';

const row = (title, added, pin) => ({ title, added, ...(pin ? { pin: true } : {}) });

test('新日期在前，同日期按标题', () => {
  const rows = [row('B', '2024-01-01'), row('A', '2024-05-01'), row('A', '2024-01-01')];
  assert.deepEqual(
    sortLinks(rows).map((r) => `${r.title}@${r.added}`),
    ['A@2024-05-01', 'A@2024-01-01', 'B@2024-01-01'],
  );
});

test('置顶优先，置顶之间仍按时间序', () => {
  const rows = [row('New', '2025-01-01'), row('OldPin', '2020-01-01', true), row('NewPin', '2024-01-01', true)];
  assert.deepEqual(sortLinks(rows).map((r) => r.title), ['NewPin', 'OldPin', 'New']);
});

test('pinned: false 时完全忽略置顶（搜索态使用）', () => {
  const rows = [row('Pin', '2020-01-01', true), row('New', '2025-01-01')];
  assert.deepEqual(sortLinks(rows, { pinned: false }).map((r) => r.title), ['New', 'Pin']);
});

test('不改原数组，pin 只认布尔 true', () => {
  const rows = [row('A', '2024-01-01'), row('B', '2024-02-01', true)];
  const before = rows.map((r) => r.title);
  sortLinks(rows);
  assert.deepEqual(rows.map((r) => r.title), before);

  // 字符串 "true" / 数字 1 不当作置顶，避免手写 YAML 的类型噪声改变排序
  const loose = [{ title: 'A', added: '2024-01-01', pin: 'true' }, { title: 'B', added: '2024-02-01' }];
  assert.deepEqual(sortLinks(loose).map((r) => r.title), ['B', 'A']);
});

test('比较函数可以直接喂给 sort', () => {
  const rows = [row('A', '2024-01-01'), row('B', '2024-03-01')];
  assert.deepEqual([...rows].sort(compareNewest).map((r) => r.title), ['B', 'A']);
  assert.equal(comparePinned(rows[0], rows[0]), 0);
});
