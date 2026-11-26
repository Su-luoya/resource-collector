// src/lib/link-data.mjs 的单元测试：`npm test`
//
// 这层逻辑被 `npm run check`（node 直跑）与 dev 编辑端点（写盘前校验）共用，
// 规则错了会直接写坏云端数据（写库前整表校验），所以先在这里钉住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { dumpLinks, parseLinks, validateRows, diffRows, diffRowDetails, hostKey } = await import(
  resolve(root, 'src/lib/link-data.mjs')
);

const taxonomy = JSON.parse(readFileSync(resolve(root, 'src/data/taxonomy.json'), 'utf8'));
const today = '2999-12-31';

const row = (patch = {}) => ({
  title: 'A 站',
  url: 'https://a.example.com',
  section: ['metrics'],
  facets: { metrics: { lang: ['python'], kind: 'pkg' } },
  desc: '示例',
  added: '2026-01-01',
  ...patch,
});

test('hostKey 去掉 www 并小写，URL 与裸域名等价', () => {
  assert.equal(hostKey('https://www.NBER.org/x'), 'nber.org');
  assert.equal(hostKey('https://nber.org'), 'nber.org');
  assert.equal(hostKey('www.nber.org'), 'nber.org');
  assert.equal(hostKey('nber.org'), 'nber.org');
  assert.equal(hostKey('https://sas.upenn.edu'), 'sas.upenn.edu');
  assert.equal(hostKey(''), '');
  assert.equal(hostKey('not a url'), ''); // 解析不了就返回空串，页面回退到首字母占位
});

test('parseLinks 同时接受顶层数组与 { links: [] } 两种写法', () => {
  const bare = parseLinks('- title: "A"\n  url: https://a.example.com\n');
  const wrapped = parseLinks('links:\n  - title: "A"\n    url: https://a.example.com\n');
  assert.equal(bare.length, 1);
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].title, 'A');
});

test('parseLinks 拒绝错误根节点，不能把写错的文件当成空库', () => {
  for (const raw of ['linkz: []', 'links: {}', 'null', 'text', 'links: []\nnote: 保留']) {
    assert.throws(() => parseLinks(raw), /链接数组/);
  }
  assert.deepEqual(parseLinks('[]'), []);
});

test('从旧包装格式编辑、删光、再新增：保留头注释，始终写成可读的顶层数组', () => {
  const head = '# 示例里也可能出现 - title:\n\n';
  const wrapped = head + 'links: ' + JSON.stringify([row()]);
  const saved = dumpLinks(parseLinks(wrapped), wrapped);
  assert.equal(saved, head + dumpLinks([row()], ''));
  const empty = dumpLinks([], saved);
  assert.equal(empty, head + '[]\n');
  assert.deepEqual(parseLinks(empty), []);
  assert.equal(dumpLinks([row()], empty), saved);
});

test('dumpLinks 保留头部注释，并把带空白的 url 加引号', () => {
  const raw = '# 注释\n\n- title: "A"\n  url: https://a.example.com\n  section: [tools]\n  facets:\n    tools: { kind: blog }\n  desc: "d"\n  added: 2026-01-01\n';
  const rows = parseLinks(raw);
  const out = dumpLinks([...rows, row({ url: 'https://b.example.com/a b' })], raw);
  assert.ok(out.startsWith('# 注释\n\n- title: "A"'));
  assert.ok(out.includes('  url: "https://b.example.com/a b"'));
  assert.equal(parseLinks(out).length, 2);
});

test('dumpLinks 转义双引号与反斜杠，解析回来不丢字符，facets 可多值', () => {
  const rows = [
    row({
      title: '他说"你好"',
      desc: 'a\\b\r\nc',
      url: 'https://a.example.com/tag:',
      section: ['data', 'metrics'],
      facets: {
        data: { kind: 'code', topic: ['micro', 'asset'] },
        metrics: { lang: ['r', 'python'], kind: 'pkg' },
      },
    }),
  ];
  const back = parseLinks(dumpLinks(rows, ''));
  assert.deepEqual(back, rows);
});

test('合法数据零 error，http 只给 warn', () => {
  const { errors, warns } = validateRows([row(), row({ url: 'http://b.example.com' })], taxonomy, today);
  assert.deepEqual(errors, []);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /非 HTTPS/);
});

test('重复 url：与 links[0] 重复也要报错（下标 0 是 falsy 的老 bug）', () => {
  const { errors } = validateRows([row(), row({ title: 'B' })], taxonomy, today);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /links\[1\]\.url 与 links\[0\] 重复/);
});

test('去重与编辑使用同一个 URL 主键：规范化主机和路径，不改查询值或锚点', () => {
  const urls = [
    'https://EXAMPLE.org:443/a/?q=1#top', 'https://example.org/a?q=1#top',
    'https://example.org/a?q=/', 'https://example.org/a?q=',
    'https://example.org/a#part/', 'https://example.org/a#part', 'http://example.org/a#part',
  ];
  const { errors } = validateRows(urls.map((url) => row({ url })), taxonomy, today);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /links\[1\]\.url 与 links\[0\] 重复/);
  assert.deepEqual(diffRows([row({ url: urls[0] })], [row({ url: urls[1] })]), { added: 0, removed: 0, changed: 1 });
});

test('空行和写回会丢失的未知字段给出行号，不抛异常', () => {
  const { errors, warns } = validateRows([null, row({ unexpected: '不要默默删掉', url: 'http://a.example.com' })], taxonomy, today);
  assert.match(errors.join('\n'), /links\[0\] 不是对象/);
  assert.match(errors.join('\n'), /links\[1\]\.unexpected/);
  assert.equal(warns.length, 1);
});

test('note / read 是合法字段：能写回，坏类型会被拦下', () => {
  const ok = validateRows(
    [row({ url: 'http://a.example.com', note: '- 关键结论\n- 下一步', read: false })],
    taxonomy,
    today,
  );
  assert.deepEqual(ok.errors, []);

  const bad = validateRows([row({ url: 'http://b.example.com', note: 42, read: 'yes' })], taxonomy, today);
  assert.match(bad.errors.join('\n'), /links\[0\]\.note/);
  assert.match(bad.errors.join('\n'), /links\[0\]\.read/);
});

test('分区：未登记、重复、非数组、空数组都会被拦下', () => {
  const { errors } = validateRows(
    [
      row({ section: [] }),
      row({ url: 'https://b.example.com', section: ['nope'] }),
      row({ url: 'https://c.example.com', section: ['tools', 'tools'], facets: { tools: { kind: 'blog' } } }),
      row({ url: 'https://d.example.com', section: 'tools', facets: {} }),
      row({ url: 'https://e.example.com', section: ['data'], facets: { metrics: { lang: ['python'], kind: 'pkg' } } }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /links\[0\]\.section 必须是非空数组/);
  assert.match(text, /links\[1\]\.section 未登记：nope/);
  assert.match(text, /links\[2\]\.section 重复：tools/);
  assert.match(text, /links\[3\]\.section 必须是非空数组/);
  assert.match(text, /links\[4\]\.facets\.data 缺失/);
  assert.match(text, /links\[4\]\.facets\.metrics 不在 section 里/);
});

test('每个分区都要写自己的分类，轴与取值必须在词表里', () => {
  const { errors } = validateRows(
    [
      row({ url: 'https://b.example.com', facets: { metrics: { lang: ['python'] } } }), // 缺 kind
      row({ url: 'https://c.example.com', facets: { metrics: { lang: ['python'], kind: 'pkg', price: 'free' } } }),
      row({ url: 'https://d.example.com', facets: { metrics: { lang: ['rust'], kind: 'pkg' } } }),
      row({ url: 'https://e.example.com', facets: { metrics: { lang: 'python', kind: 'pkg' } } }), // 多选写成单值
      row({ url: 'https://f.example.com', facets: { metrics: { lang: ['python'], kind: ['pkg'] } } }), // 单选写成数组
      row({ url: 'https://g.example.com', facets: { metrics: { lang: ['python', 'python'], kind: 'pkg' } } }),
      row({ url: 'https://h.example.com', facets: 'metrics' }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /links\[0\]\.facets\.metrics\.kind 缺失/);
  assert.match(text, /links\[1\]\.facets\.metrics\.price 不在该分区词表里/);
  assert.match(text, /links\[2\]\.facets\.metrics\.lang 未登记：rust/);
  assert.match(text, /links\[3\]\.facets\.metrics\.lang 可多选，必须写成数组/);
  assert.match(text, /links\[4\]\.facets\.metrics\.kind 单选，不能写成数组/);
  assert.match(text, /links\[5\]\.facets\.metrics\.lang 重复：python/);
  assert.match(text, /links\[6\]\.facets 必须是对象/);
});

test('旧的 type / topics 字段会被当成错误（避免两套轴并存）', () => {
  const { errors } = validateRows([row({ type: 'code', topics: ['econ'] })], taxonomy, today);
  const text = errors.join('\n');
  assert.match(text, /links\[0\]\.type 已废弃/);
  assert.match(text, /links\[0\]\.topics 已废弃/);
});

test('必填字段缺失与日期格式都会被拦下', () => {
  const { errors, warns } = validateRows(
    [
      row({ title: '   ' }),
      row({ url: 'https://b.example.com', desc: '' }),
      row({ url: 'https://c.example.com', added: '2026/01/01' }),
      row({ url: 'https://d.example.com', added: '3000-01-01' }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /links\[0\]\.title 缺失或为空/);
  assert.match(text, /links\[1\]\.desc 缺失或为空/);
  assert.match(text, /links\[2\]\.added 必须是 YYYY-MM-DD/);
  // 未来日期只是 warn，不能挡住写盘
  assert.equal(errors.filter((e) => /未来/.test(e)).length, 0);
  assert.match(warns.join('\n'), /links\[3\]\.added 是未来日期/);
});

test('added 必须是实际存在的日期：接受闰日，不接受溢出或非字符串', () => {
  for (const added of ['2025-02-29', '2026-04-31', '2026-13-01', ['2024-02-29']]) {
    assert.match(validateRows([row({ added })], taxonomy, today).errors.join('\n'), /links\[0\]\.added/);
  }
  assert.deepEqual(validateRows([row({ added: '2024-02-29' })], taxonomy, today).errors, []);
});

test('url 必须是 http(s)、不能含空白、必须能解析', () => {
  const { errors } = validateRows(
    [
      row({ url: 'ftp://a.example.com' }),
      row({ url: 'https://b.example.com/a b' }),
      row({ url: 'https://' }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /必须以 http\(s\):\/\/ 开头/);
  assert.match(text, /含空白字符/);
  assert.match(text, /解析失败/);
});

test('title/desc 超长会报错', () => {
  const { errors } = validateRows(
    [
      row({ title: 'x'.repeat(81) }),
      row({ url: 'https://b.example.com', desc: 'y'.repeat(121) }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /title 超过 80 字/);
  assert.match(text, /desc 超过 120 字/);
});

test('顶层不是数组时直接报错，不抛异常', () => {
  assert.deepEqual(validateRows({ foo: 1 }, taxonomy, today).errors, ['数据顶层必须是链接数组']);
});

test('diffRows 按 url 给出 新增 / 删除 / 修改', () => {
  const before = [row(), row({ url: 'https://b.example.com' })];
  const after = [row({ title: 'A 站改名' }), row({ url: 'https://c.example.com' })];
  assert.deepEqual(diffRows(before, after), { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(diffRows(before, before), { added: 0, removed: 0, changed: 0 });
});

test('diffRowDetails：同名唯一的一删一增配成修改，而不是删+增', () => {
  const before = [row({ url: 'https://a.example.com/old' })];
  const after = [row({ url: 'https://a.example.com/new' })];
  const details = diffRowDetails(before, after);
  assert.equal(details.added.length, 0);
  assert.equal(details.removed.length, 0);
  assert.equal(details.changed.length, 1);
  assert.equal(details.changed[0].before.url, 'https://a.example.com/old');
  assert.equal(details.changed[0].after.url, 'https://a.example.com/new');
  assert.deepEqual(diffRows(before, after), { added: 0, removed: 0, changed: 1 });
});

test('diffRowDetails：同名不唯一时不猜测配对，仍按删除 + 新增', () => {
  const before = [row({ url: 'https://a.example.com/1' })];
  const after = [
    row({ url: 'https://a.example.com/2' }),
    row({ url: 'https://a.example.com/3' }),
  ];
  const details = diffRowDetails(before, after);
  assert.equal(details.changed.length, 0);
  assert.equal(details.added.length, 2);
  assert.equal(details.removed.length, 1);
});

test('diffRowDetails：同名资源很多时不做配对，删除不会被藏成修改', () => {
  const before = [
    row({ title: 'GitHub', url: 'https://github.com/a' }),
    row({ title: 'GitHub', url: 'https://github.com/b' }),
  ];
  const after = [row({ title: 'GitHub', url: 'https://github.com/c' })];
  const details = diffRowDetails(before, after);
  assert.equal(details.changed.length, 0);
  assert.equal(details.removed.length, 2);
  assert.equal(details.added.length, 1);
});

test('diffRowDetails：两侧同名各一条但内容不同，也只当修改', () => {
  const details = diffRowDetails(
    [row({ url: 'https://a.example.com', desc: '旧' })],
    [row({ url: 'https://a.example.com', desc: '新' })],
  );
  assert.equal(details.changed.length, 1);
  assert.equal(details.changed[0].before.desc, '旧');
  assert.equal(details.added.length + details.removed.length, 0);
});

test('pin 已下线：写回 YAML 不再带这个字段，残留的 pin 会被校验拦下', () => {
  assert.equal(dumpLinks([row()], '').includes('pin'), false);
  const stale = row({ pin: true });
  assert.ok(validateRows([stale], taxonomy).errors.some((e) => e.includes('pin')));
});
