import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbors, relatedFor, sameHostOf } from '../src/lib/related.mjs';

const link = (url, patch = {}) => ({
  title: url,
  url,
  section: ['metrics'],
  facets: { metrics: { kind: 'pkg' } },
  desc: '',
  added: '2026-01-01',
  ...patch,
});

test('同站点条目按时间排，排除自己并忽略 www 前缀', () => {
  const rows = [
    link('https://a.com/1', { title: '一', added: '2026-01-01' }),
    link('https://www.a.com/2', { title: '二', added: '2026-02-01' }),
    link('https://b.com/', { title: '三' }),
  ];
  assert.deepEqual(sameHostOf(rows[0], rows).map((r) => r.title), ['二']);
});

test('相关度：同站点优先，其次共享分类，无关条目不出现', () => {
  const target = link('https://a.com/1', { facets: { metrics: { kind: 'pkg', lang: ['python', 'r'] } } });
  const rows = [
    target,
    link('https://www.a.com/2', {
      title: '同站点',
      facets: { metrics: { kind: 'pkg' } },
      added: '2025-01-01',
    }),
    link('https://b.com/3', {
      title: '同分类',
      facets: { metrics: { kind: 'pkg', lang: ['python'] } },
      added: '2026-01-01',
    }),
    link('https://c.com/4', {
      title: '无关',
      section: ['writing'],
      facets: { writing: { kind: 'doc' } },
    }),
  ];

  assert.deepEqual(relatedFor(target, rows).map((r) => r.title), ['同站点', '同分类']);
  assert.deepEqual(relatedFor(target, rows, 1).map((r) => r.title), ['同站点']);
});

test('分区内上下条按时间排，置顶不参与', () => {
  const rows = [
    link('https://a.com/1', { title: '新', added: '2026-03-01', pin: true }),
    link('https://a.com/2', { title: '中', added: '2026-02-01' }),
    link('https://a.com/3', { title: '旧', added: '2026-01-01' }),
    link('https://b.com/1', { title: '别区', section: ['tools'], added: '2026-04-01' }),
  ];

  const nav = neighbors(rows[1], rows, 'metrics');
  assert.equal(nav.prev?.title, '新');
  assert.equal(nav.next?.title, '旧');
  assert.equal(neighbors(rows[0], rows, 'metrics').prev, null);
  assert.equal(neighbors(rows[2], rows, 'metrics').next, null);
});
