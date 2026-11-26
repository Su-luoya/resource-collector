import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, fromRow, fromStatusRow, toIconRow, toRow } from '../src/lib/cloud.mjs';

const link = {
  title: 'A/B 测试计算器',
  url: 'https://example.com/ab',
  section: ['tools'],
  facets: { tools: { kind: 'service' } },
  desc: '算样本量与功效',
  added: '2025-02-01',
  note: '- 用过一次',
  read: false,
};

test('toRow 把内部表示摊平成库里的列', () => {
  const row = toRow(link);
  assert.equal(row.desc, '算样本量与功效');
  assert.equal('pin' in row, false, '置顶已下线，库里不再有这一列');
  assert.equal(row.note, '- 用过一次');
  assert.equal(row.unread, true, 'read: false 要变成 unread: true');
  assert.notEqual(row.section, link.section, '数组要复制，不能和内部对象共用引用');
});

test('toRow 不写多余字段：空笔记要显式 null', () => {
  const { note, ...rest } = toRow({ ...link, note: '   ', read: true });
  // null 而不是省掉键：合并更新时缺键不会清掉库里已有的笔记
  assert.equal(note, null);
  assert.equal(rest.unread, false);
});

test('fromRow 只在有意义时带出可选字段', () => {
  const plain = fromRow({ url: 'https://a.b', title: 'A', section: ['tools'], facets: {}, desc: 'd', added: '2025-01-02T03:04:05Z' });
  assert.equal(plain.added, '2025-01-02', '带时间的时间戳要截成日期');
  assert.equal('pin' in plain, false, '老库里残留的 pin 列不该回到内部对象');
  assert.equal('note' in plain, false);
  assert.equal('read' in plain, false);

  const full = fromRow({ url: link.url, title: link.title, section: link.section, facets: link.facets, desc: link.desc, added: '2025-02-01', pin: true, note: 'x', unread: true });
  assert.equal(full.read, false);
  assert.equal('pin' in full, false, '置顶字段被忽略');
  assert.equal(full.note, 'x');
});

test('来回转换不丢字段', () => {
  assert.deepEqual(fromRow(toRow(link)), link);
  const bare = { title: 'B', url: 'https://b.c', section: ['scholar'], facets: { scholar: { field: [] } }, desc: 'd', added: '2025-03-04' };
  assert.deepEqual(fromRow(toRow(bare)), bare);
});

test('体检行与图标行', () => {
  assert.deepEqual(fromStatusRow({ url: 'https://a.b', status: 'ok', code: 200, checked: '2025-05-06T07:08:09Z' }), {
    url: 'https://a.b',
    status: 'ok',
    code: 200,
    checked: '2025-05-06',
  });
  assert.deepEqual(toIconRow({ host: 'a.b', file: 'a.b.png' }), { host: 'a.b', file: 'a.b.png', missed_at: null });
  const miss = toIconRow({ host: 'a.b', file: null, missedAt: '2025-05-06T00:00:00.000Z' });
  assert.equal(miss.file, null);
  assert.equal(miss.missed_at, '2025-05-06T00:00:00.000Z');
});

const fakeFetch = (calls, reply = ({ url }) => ({ status: 200, body: /select=url/.test(url) ? [] : '' })) => async (url, init) => {
  calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, prefer: init.headers.Prefer });
  const { status, body } = reply({ url, method: init.method, init });
  return { ok: status < 400, status, statusText: '', text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
};

test('upsertLinks 一个请求写一批行', async () => {
  const calls = [];
  const client = createClient({ url: 'https://x.supabase.co/', key: 'k', fetchImpl: fakeFetch(calls, () => ({ status: 201, body: '' })) });
  await client.upsertLinks([link, { ...link, url: 'https://example.com/cd' }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/links\?on_conflict=url$/);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(calls[0].body.length, 2);
  assert.equal(calls[0].body[0].unread, true, 'read: false 要变成 unread: true');
  assert.equal(calls[0].body[1].url, 'https://example.com/cd');
});

test('空数组什么都不写', async () => {
  const calls = [];
  const client = createClient({ url: 'https://x.supabase.co', key: 'k', fetchImpl: fakeFetch(calls) });
  await client.upsertLinks([]);
  await client.upsertStatuses([]);
  await client.upsertIcons([]);
  assert.deepEqual(calls, []);
});

test('整表读取按 offset 翻页：服务端每页只给 2 行也拿得全', async () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({ url: `https://a.example/${n}`, section: ['tools'], facets: {}, desc: 'd', added: '2026-01-01' }));
  const calls = [];
  const client = createClient({
    url: 'https://x.supabase.co',
    key: 'k',
    // 模拟 Max Rows 比请求的每页小：一次只回 2 行，短页不能当成读完了
    fetchImpl: async (url) => {
      calls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset') ?? 0);
      return { ok: true, status: 206, statusText: '', text: async () => JSON.stringify(rows.slice(offset, offset + 2)) };
    },
  });
  const out = await client.listLinks();
  assert.deepEqual(out.map((row) => row.url), rows.map((row) => row.url), '五行都要拿到，不能只拿前两行');
  assert.match(calls[1], /offset=2(&|$)/, '下一页从上一页末尾继续');
  assert.equal(calls.length, 4, '2+2+1 行，再请求一页空的才算读完');
});

test('upsertStatuses 一个请求写完一轮体检', async () => {
  const calls = [];
  const client = createClient({ url: 'https://x.supabase.co', key: 'k', fetchImpl: fakeFetch(calls, () => ({ status: 201, body: '' })) });
  await client.upsertStatuses([
    { url: 'https://a.b', status: 'ok', code: 200, checked: '2025-05-06' },
    { url: 'https://c.d', status: 'fail', code: 404, checked: '2025-05-06' },
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/link_status\?on_conflict=url$/);
  assert.equal(calls[0].body.length, 2);
  assert.deepEqual(calls[0].body[1], { url: 'https://c.d', status: 'fail', checked: '2025-05-06', code: 404 });
});

test('出错时把状态码与响应片段带进异常', async () => {
  const calls = [];
  const client = createClient({
    url: 'https://x.supabase.co',
    key: 'k',
    fetchImpl: fakeFetch(calls, () => ({ status: 403, body: '{"message":"permission denied for table links"}' })),
  });
  await assert.rejects(() => client.upsertLink(link), /HTTP 403.*permission denied/);
});
