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
  section: ['packages'],
  facets: { packages: { lang: ['python'], kind: 'pkg' } },
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

test('dumpLinks 对仓库现有 links.yaml 逐字节复现', () => {
  const raw = readFileSync(resolve(root, 'src/data/links.yaml'), 'utf8');
  assert.equal(dumpLinks(parseLinks(raw), raw), raw);
});

test('dumpLinks 保留头部注释，并把带空白的 url 加引号', () => {
  const raw = '# 注释\n\n- title: "A"\n  url: https://a.example.com\n  section: [nav]\n  facets:\n    nav: { kind: blog }\n  desc: "d"\n  added: 2026-01-01\n';
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
      desc: 'a\\b',
      section: ['data', 'packages'],
      facets: {
        data: { kind: 'code', topic: ['micro', 'asset'] },
        packages: { lang: ['r', 'python'], kind: 'pkg' },
      },
    }),
  ];
  const back = parseLinks(dumpLinks(rows, ''));
  assert.equal(back[0].title, '他说"你好"');
  assert.equal(back[0].desc, 'a\\b');
  assert.deepEqual(back[0].section, ['data', 'packages']);
  assert.deepEqual(back[0].facets, rows[0].facets);
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

test('分区：未登记、重复、非数组、空数组都会被拦下', () => {
  const { errors } = validateRows(
    [
      row({ section: [] }),
      row({ url: 'https://b.example.com', section: ['nope'] }),
      row({ url: 'https://c.example.com', section: ['nav', 'nav'], facets: { nav: { kind: 'blog' } } }),
      row({ url: 'https://d.example.com', section: 'nav', facets: {} }),
      row({ url: 'https://e.example.com', section: ['data'], facets: { packages: { lang: ['python'], kind: 'pkg' } } }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /links\[0\]\.section 必须是非空数组/);
  assert.match(text, /links\[1\]\.section 未登记：nope/);
  assert.match(text, /links\[2\]\.section 重复：nav/);
  assert.match(text, /links\[3\]\.section 必须是非空数组/);
  assert.match(text, /links\[4\]\.facets\.data 缺失/);
  assert.match(text, /links\[4\]\.facets\.packages 不在 section 里/);
});

test('每个分区都要写自己的分类，轴与取值必须在词表里', () => {
  const { errors } = validateRows(
    [
      row({ url: 'https://b.example.com', facets: { packages: { lang: ['python'] } } }), // 缺 kind
      row({ url: 'https://c.example.com', facets: { packages: { lang: ['python'], kind: 'pkg', price: 'free' } } }),
      row({ url: 'https://d.example.com', facets: { packages: { lang: ['rust'], kind: 'pkg' } } }),
      row({ url: 'https://e.example.com', facets: { packages: { lang: 'python', kind: 'pkg' } } }), // 多选写成单值
      row({ url: 'https://f.example.com', facets: { packages: { lang: ['python'], kind: ['pkg'] } } }), // 单选写成数组
      row({ url: 'https://g.example.com', facets: { packages: { lang: ['python', 'python'], kind: 'pkg' } } }),
      row({ url: 'https://h.example.com', facets: 'packages' }),
    ],
    taxonomy,
    today,
  );
  const text = errors.join('\n');
  assert.match(text, /links\[0\]\.facets\.packages\.kind 缺失/);
  assert.match(text, /links\[1\]\.facets\.packages\.price 不在该分区词表里/);
  assert.match(text, /links\[2\]\.facets\.packages\.lang 未登记：rust/);
  assert.match(text, /links\[3\]\.facets\.packages\.lang 可多选，必须写成数组/);
  assert.match(text, /links\[4\]\.facets\.packages\.kind 单选，不能写成数组/);
  assert.match(text, /links\[5\]\.facets\.packages\.lang 重复：python/);
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
  assert.deepEqual(validateRows({ foo: 1 }, taxonomy, today).errors, ['links.yaml 顶层必须是链接数组']);
});

test('diffRows 按 url 给出 新增 / 删除 / 修改', () => {
  const before = [row(), row({ url: 'https://b.example.com' })];
  const after = [row({ title: 'A 站改名' }), row({ url: 'https://c.example.com' })];
  assert.deepEqual(diffRows(before, after), { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(diffRows(before, before), { added: 0, removed: 0, changed: 0 });
});
