// src/lib/link-quality.mjs 的单元测试：`npm test`
//
// 这里只做「提示」不做「拦截」，所以测试重点在两侧边界：
// 该报的必须报（避免重复收录），不该报的绝不能报（避免误导用户放弃合法收录）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { cleanupUrl, findDuplicateCandidates, scanDuplicates } = await import(
  resolve(root, 'src/lib/link-quality.mjs')
);

const row = (patch = {}) => ({
  title: 'A 站',
  url: 'https://a.example.com',
  ...patch,
});

test('cleanupUrl 只删跟踪参数，保留有实义的查询参数', () => {
  assert.deepEqual(cleanupUrl('https://a.example.com/p?id=7&utm_source=x&utm_medium=y'), {
    url: 'https://a.example.com/p?id=7',
    removed: ['utm_source', 'utm_medium'],
  });
  assert.deepEqual(cleanupUrl('https://a.example.com/p?fbclid=abc&q=1'), {
    url: 'https://a.example.com/p?q=1',
    removed: ['fbclid'],
  });
  assert.equal(cleanupUrl('https://a.example.com/p?id=7'), null);
  assert.equal(cleanupUrl('https://a.example.com/'), null);
});

test('cleanupUrl 不清空路径，也不改动无跟踪参数的 URL', () => {
  assert.equal(cleanupUrl('https://a.example.com/?utm_campaign=x').url, 'https://a.example.com/');
});

test('findDuplicateCandidates：URL 完全相同报「URL 已存在」', () => {
  const found = findDuplicateCandidates({ url: 'https://a.example.com/p', rows: [row({ url: 'https://a.example.com/p' })] });
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'URL 已存在');
});

test('findDuplicateCandidates：末尾斜杠与跟踪参数差异都算同一页', () => {
  const rows = [row({ url: 'https://a.example.com/p' })];
  assert.equal(
    findDuplicateCandidates({ url: 'https://a.example.com/p/', rows })[0].reason,
    'URL 已存在',
  );
  const tracked = findDuplicateCandidates({ url: 'https://a.example.com/p?utm_source=x', rows });
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].reason, '清理跟踪参数后相同');
});

test('findDuplicateCandidates：协议、www、锚点差异只给「URL 变体」候选', () => {
  const rows = [row({ url: 'https://www.a.example.com/p' })];
  for (const url of ['http://a.example.com/p', 'https://a.example.com/p#section']) {
    const found = findDuplicateCandidates({ url, rows });
    assert.equal(found.length, 1, url);
    assert.equal(found[0].reason, '可能是同一页面的 URL 变体', url);
  }
});

test('findDuplicateCandidates：不同路径不报候选', () => {
  const found = findDuplicateCandidates({
    url: 'https://a.example.com/other',
    rows: [row({ url: 'https://a.example.com/p' })],
  });
  assert.deepEqual(found, []);
});

test('findDuplicateCandidates：同站点同名才靠标题兜底，跨站点同名不报', () => {
  const rows = [row({ title: 'Data Portal', url: 'https://a.example.com/en' })];
  const sameSite = findDuplicateCandidates({ url: 'https://a.example.com/zh', title: 'data-portal', rows });
  assert.equal(sameSite[0].reason, '同站点、同名资源');
  const otherSite = findDuplicateCandidates({ url: 'https://b.example.com/zh', title: 'Data Portal', rows });
  assert.deepEqual(otherSite, []);
});

test('findDuplicateCandidates：标题为空时不靠标题兜底', () => {
  const found = findDuplicateCandidates({ url: 'https://a.example.com/x', title: '', rows: [row({ title: 'A 站' })] });
  assert.deepEqual(found, []);
});

test('findDuplicateCandidates：编辑时排除自身', () => {
  const rows = [row({ url: 'https://a.example.com/p' })];
  assert.deepEqual(
    findDuplicateCandidates({ url: 'https://a.example.com/p', rows, excludeUrl: 'https://a.example.com/p' }),
    [],
  );
});

test('findDuplicateCandidates：候选按分数排序并受 limit 限制', () => {
  const rows = [
    row({ url: 'https://a.example.com/p/2', title: 'B' }),
    row({ url: 'https://a.example.com/p', title: 'C' }),
    row({ url: 'https://www.a.example.com/p', title: 'D' }),
  ];
  const found = findDuplicateCandidates({ url: 'https://a.example.com/p', rows, limit: 2 });
  assert.equal(found.length, 2);
  assert.equal(found[0].reason, 'URL 已存在');
});

test('scanDuplicates：三种规则各自命中，且同组不重复报', () => {
  const rows = [
    row({ url: 'https://a.example.com/x', title: 'A' }),
    row({ url: 'https://A.example.com/x/', title: 'A 两遍' }),
    row({ url: 'https://b.example.com/y?utm_source=news', title: 'B' }),
    row({ url: 'https://b.example.com/y', title: 'B 干净' }),
    row({ url: 'https://c.example.com/1', title: 'Same' }),
    row({ url: 'https://www.c.example.com/2', title: 'same' }),
    row({ url: 'https://d.example.com/only', title: '唯一' }),
  ];
  const { checked, groups } = scanDuplicates(rows);
  assert.equal(checked, 7);
  assert.deepEqual(groups.map((g) => g.kind), ['same_url', 'same_cleaned', 'same_host_title']);
  assert.deepEqual(groups.map((g) => g.items.length), [2, 2, 2]);
});

test('scanDuplicates：干净的库不报任何组', () => {
  const rows = [
    row({ url: 'https://a.example.com/x', title: 'A' }),
    row({ url: 'https://b.example.com/x', title: 'A' }),
  ];
  assert.deepEqual(scanDuplicates(rows).groups, []);
  assert.deepEqual(scanDuplicates([]).groups, []);
});

test('scanDuplicates：同站点不同标题不算重复', () => {
  const rows = [
    row({ url: 'https://a.example.com/x', title: 'X' }),
    row({ url: 'https://a.example.com/y', title: 'Y' }),
  ];
  assert.deepEqual(scanDuplicates(rows).groups, []);
});
