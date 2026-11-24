import test from 'node:test';
import assert from 'node:assert/strict';
import { slugOf, slugMap } from '../src/lib/slug.mjs';

test('slug 只留字母数字与连字符，丢掉协议/查询/锚点', () => {
  assert.equal(slugOf('https://www.example.com/a/b?x=1#top'), 'example-com-a-b');
  assert.equal(slugOf('https://arxiv.org/abs/2401.00001'), 'arxiv-org-abs-2401-00001');
});

test('非 http(s) 与空值给空串，不生成地址', () => {
  assert.equal(slugOf('ftp://example.com/x'), '');
  assert.equal(slugOf(''), '');
  assert.equal(slugOf(null), '');
});

test('同一 URL 永远得到同一个 slug（重排 YAML 不会改地址）', () => {
  assert.equal(slugOf('https://example.com/x'), slugOf('https://example.com/x'));
});

test('超长路径会截断；截断后 slugOf 可能撞车，但 slugMap 会补序号区分开', () => {
  const base = 'https://example.com/' + 'a'.repeat(90);
  const one = base + '/one';
  const two = base + '/two';
  assert.ok(slugOf(one).length <= 72);
  const map = slugMap([{ url: one }, { url: two }]);
  assert.equal(new Set([...map.values()]).size, 2);
});

test('slugMap 撞车时按 URL 字典序加序号，与行序无关', () => {
  const rows = [
    { url: 'https://example.com/a%20b' },
    { url: 'https://example.com/a-b' },
  ];
  const forward = slugMap(rows);
  const backward = slugMap([...rows].reverse());
  assert.equal(forward.get(rows[0].url), backward.get(rows[0].url));
  assert.equal(new Set([...forward.values()]).size, 2);
});

test('不同站点的根路径不会都退化成空串', () => {
  const map = slugMap([{ url: 'https://a.io/' }, { url: 'https://b.io/' }]);
  assert.deepEqual([...map.values()].sort(), ['a-io', 'b-io']);
});
