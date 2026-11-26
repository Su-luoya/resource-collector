import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNewest, sortLinks } from '../src/lib/ordering.mjs';

const row = (title, added) => ({ title, added });

test('新日期在前，同日期按标题', () => {
  const rows = [row('B', '2024-01-01'), row('A', '2024-05-01'), row('A', '2024-01-01')];
  assert.deepEqual(
    sortLinks(rows).map((r) => `${r.title}@${r.added}`),
    ['A@2024-05-01', 'A@2024-01-01', 'B@2024-01-01'],
  );
});

test('不改原数组', () => {
  const rows = [row('A', '2024-01-01'), row('B', '2024-02-01')];
  const before = rows.map((r) => r.title);
  sortLinks(rows);
  assert.deepEqual(rows.map((r) => r.title), before);
});

test('比较函数可以直接喂给 sort', () => {
  const rows = [row('A', '2024-01-01'), row('B', '2024-03-01')];
  assert.deepEqual([...rows].sort(compareNewest).map((r) => r.title), ['B', 'A']);
  assert.equal(compareNewest(rows[0], rows[0]), 0);
});
