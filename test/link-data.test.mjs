// src/lib/link-data.mjs 的单元测试：`npm test`
//
// 这层逻辑被 `npm run check`（node 直跑）与 dev 编辑端点（写盘前校验）共用，
// 规则错了会直接写坏 src/data/links.yaml，所以先在这里钉住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { dumpLinks, parseLinks, validateRows, diffRows, hostKey } = await import(
  resolve(root, 'src/lib/link-data.mjs')
);

const taxonomy = JSON.parse(readFileSync(resolve(root, 'src/data/taxonomy.json'), 'utf8'));
const today = '2999-12-31';

const row = (patch = {}) => ({
  title: 'A 站',
  url: 'https://a.example.com',
  type: 'code',
  topics: [],
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
  assert.deepEqual(bare[0].topics, []);
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].title, 'A');
});

test('dumpLinks 对仓库现有 links.yaml 逐字节复现', () => {
  const raw = readFileSync(resolve(root, 'src/data/links.yaml'), 'utf8');
  assert.equal(dumpLinks(parseLinks(raw), raw), raw);
});

test('dumpLinks 保留头部注释，并把带空白的 url 加引号', () => {
  const raw = '# 注释\n\n- title: "A"\n  url: https://a.example.com\n  type: code\n  topics: []\n  desc: "d"\n  added: 2026-01-01\n';
  const rows = parseLinks(raw);
  const out = dumpLinks([...rows, row({ url: 'https://b.example.com/a b' })], raw);
  assert.ok(out.startsWith('# 注释\n\n- title: "A"'));
  assert.ok(out.includes('  url: "https://b.example.com/a b"'));
  assert.equal(parseLinks(out).length, 2);
});

test('dumpLinks 转义双引号与反斜杠，解析回来不丢字符', () => {
  const rows = [row({ title: '他说"你好"', desc: 'a\\b' })];
  const back = parseLinks(dumpLinks(rows, ''));
  assert.equal(back[0].title, '他说"你好"');
  assert.equal(back[0].desc, 'a\\b');
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

test('必填字段缺失、类型未登记、主题未登记都会被拦下', () => {
  const { errors, warns } = validateRows(
    [
      row({ title: '   ' }),
      row({ url: 'https://b.example.com', desc: '' }),
      row({ url: 'https://c.example.com', type: 'nope' }),
      row({ url: 'https://d.example.com', topics: ['nope'] }),
      row({ url: 'https://e.example.com', topics: ['econ', 'econ'] }),
      row({ url: 'https://f.example.com', added: '2026/01/01' }),
      row({ url: 'https://g.example.com', added: '3000-01-01' }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /links\[0\]\.title 缺失或为空/);
  assert.match(text, /links\[1\]\.desc 缺失或为空/);
  assert.match(text, /links\[2\]\.type 未登记：nope/);
  assert.match(text, /links\[3\]\.topics 未登记：nope/);
  assert.match(text, /links\[4\]\.topics 重复：econ/);
  assert.match(text, /links\[5\]\.added 必须是 YYYY-MM-DD/);
  // 未来日期只是 warn，不能挡住写盘
  assert.equal(errors.filter((e) => /未来/.test(e)).length, 0);
  assert.match(warns.join('\n'), /links\[6\]\.added 是未来日期/);
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

test('title/desc 超长、topics 不是数组都会报错', () => {
  const { errors } = validateRows(
    [
      row({ title: 'x'.repeat(81) }),
      row({ url: 'https://b.example.com', desc: 'y'.repeat(121) }),
      row({ url: 'https://c.example.com', topics: 'econ' }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /title 超过 80 字/);
  assert.match(text, /desc 超过 120 字/);
  assert.match(text, /topics 必须是数组/);
});

test('顶层不是数组时直接报错，不抛异常', () => {
  assert.deepEqual(validateRows({ foo: 1 }, taxonomy, today).errors, ['links.yaml 顶层必须是链接数组']);
});

test('diffRows 按 url 给出 新增 / 删除 / 修改', () => {
  const before = [row(), row({ url: 'https://b.example.com' })];
  const after = [row({ title: 'A 站改名' }), row({ url: 'https://c.example.com' })];
  assert.deepEqual(diffRows(before, after), { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(diffRows(before, before), { added: 0, removed: 0, changed: 0 });
});
