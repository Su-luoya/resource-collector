import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, fromRow, fromStatusRow, toIconRow, toRow } from '../src/lib/cloud.mjs';

const link = {
  title: 'A/B 测试计算器',
  url: 'https://example.com/ab',
  section: ['packages'],
  facets: { packages: { lang: ['r'], kind: 'tool' } },
  desc: '算样本量与功效',
  added: '2025-02-01',
  pin: true,
  note: '- 用过一次',
  read: false,
};

test('toRow 把内部表示摊平成库里的列', () => {
  const row = toRow(link);
  assert.equal(row.desc, '算样本量与功效');
  assert.equal(row.pin, true);
  assert.equal(row.note, '- 用过一次');
  assert.equal(row.unread, true, 'read: false 要变成 unread: true');
  assert.notEqual(row.section, link.section, '数组要复制，不能和内部对象共用引用');
});

test('toRow 不写多余字段：没有 pin 就是 false，空笔记要显式 null', () => {
  const { note, pin, ...rest } = toRow({ ...link, pin: undefined, note: '   ', read: true });
  // null 而不是省掉键：合并更新时缺键不会清掉库里已有的笔记
  assert.equal(note, null);
  assert.equal(pin, false);
  assert.equal(rest.unread, false);
});

test('fromRow 只在有意义时带出可选字段', () => {
  const plain = fromRow({ url: 'https://a.b', title: 'A', section: ['nav'], facets: {}, desc: 'd', added: '2025-01-02T03:04:05Z' });
  assert.equal(plain.added, '2025-01-02', '带时间的时间戳要截成日期');
  assert.equal('pin' in plain, false);
  assert.equal('note' in plain, false);
  assert.equal('read' in plain, false);

  const full = fromRow({ url: link.url, title: link.title, section: link.section, facets: link.facets, desc: link.desc, added: '2025-02-01', pin: true, note: 'x', unread: true });
  assert.equal(full.read, false);
  assert.equal(full.pin, true);
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

test('replaceLinks 先 upsert 再删掉库里多出来的行', async () => {
  const calls = [];
  const client = createClient({
    url: 'https://x.supabase.co/',
    key: 'k',
    fetchImpl: fakeFetch(calls, ({ url, method }) =>
      method === 'GET' ? { status: 200, body: [{ url: link.url }, { url: 'https://old.example/x,y' }] } : { status: 200, body: url },
    ),
  });
  await client.replaceLinks([link]);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/rest\/v1\/links\?select=url$/);
  assert.match(calls[1].url, /\/rest\/v1\/links\?on_conflict=url$/);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(calls[1].body[0].url, link.url, '本次的行要 upsert');
  assert.equal(calls[2].method, 'DELETE');
  assert.match(calls[2].url, /url=in\.\("https:\/\/old\.example\/x,y"\)$/, '只在库里、不在本次列表里的行要删掉，带逗号的 URL 要整体加引号');
});

test('库已对齐时什么都不写；库里有多余行时只删那些行', async () => {
  const aligned = [];
  await createClient({ url: 'https://x.supabase.co', key: 'k', fetchImpl: fakeFetch(aligned) }).replaceLinks([]);
  assert.deepEqual(aligned.map((call) => call.method), ['GET'], '空库传空列表：只查一次就结束');

  const stale = [];
  const client = createClient({
    url: 'https://x.supabase.co',
    key: 'k',
    fetchImpl: fakeFetch(stale, ({ method }) => ({ status: 200, body: method === 'GET' ? [{ url: 'https://gone.example/a' }] : '' })),
  });
  await client.replaceLinks([]);
  assert.deepEqual(stale.map((call) => call.method), ['GET', 'DELETE']);
  assert.match(stale[1].url, /url=in\.\("https:\/\/gone\.example\/a"\)$/);
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
