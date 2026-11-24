// src/lib/dev-meta.mjs 的单元测试：dev「＋ 新增」流程里抓标题/简介的那套逻辑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { clean, normUrl, decodeEntities, extractMeta } = await import(
  resolve(root, 'src/lib/dev-meta.mjs')
);

const page = (head) => `<html><head>${head}</head><body>x</body></html>`;

test('clean 折叠空白、去首尾空格', () => {
  assert.equal(clean('  a\n\t b   c '), 'a b c');
  assert.equal(clean(''), '');
  assert.equal(clean(null), '');
  assert.equal(clean(undefined), '');
});

test('clean 截断时不会切出半个代理对', () => {
  const out = clean('😀'.repeat(200), 5);
  assert.equal(out, '😀😀'); // 5 个 UTF-16 码元放不下第 3 个 emoji，整个砍掉
  assert.ok(out.isWellFormed(), '不能留下孤立的代理码元');
  assert.equal(clean('abcdef', 3), 'abc');
});

test('normUrl 补 https、规范化 host 与路径', () => {
  const norm = (s) => normUrl(s).url;
  assert.equal(norm('example.com/a'), 'https://example.com/a');
  assert.equal(norm('  https://example.com  '), 'https://example.com/');
  assert.equal(norm('HTTPS://EXAMPLE.COM:443/Path'), 'https://example.com/Path');
  assert.equal(norm('http://example.com:80/x'), 'http://example.com/x');
  assert.equal(norm('https://example.com/a#frag'), 'https://example.com/a#frag');
  assert.equal(norm('  '), undefined);
});

test('normUrl 只放行 http(s)，拒绝含空白与解析不了的值', () => {
  assert.match(normUrl('javascript:alert(1)').error, /只接受 http\(s\) 链接/);
  assert.match(normUrl('ftp://example.com').error, /只接受 http\(s\) 链接/);
  assert.match(normUrl('https://example.com/a b').error, /空白/);
  assert.match(normUrl('https://').error, /解析失败/);
  assert.equal(normUrl('javascript:alert(1)').url, undefined);
  assert.match(normUrl('').error, /不能为空/);
});

test('decodeEntities：命名实体、数字实体、未知实体', () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;"), "a & b <c> \"d\" 'e'");
  assert.equal(decodeEntities('&#39;&#x27;&#8212;'), "''\u2014");
  assert.equal(decodeEntities('&rsquo;&hellip;&mdash;&middot;&times;'), '\u2019\u2026\u2014\u00b7\u00d7');
  assert.equal(decodeEntities('&unknown; &amp;lt;'), '&unknown; &lt;'); // 不二次解码
  assert.equal(decodeEntities(''), '');
});

test('extractMeta 取 title 与 meta description', () => {
  const meta = extractMeta(page('<title>  A  &amp;  B </title><meta name="description" content="简介">'));
  assert.equal(meta.title, 'A & B');
  assert.equal(meta.desc, '简介');
  assert.equal(meta.source, 'description');
});

test('extractMeta 支持属性顺序颠倒与单引号', () => {
  assert.equal(extractMeta(page(`<meta content='折叠' name='description'>`)).desc, '折叠');
  assert.equal(extractMeta(page(`<meta content="折叠" name="description"/>`)).desc, '折叠');
  assert.equal(extractMeta(page('<meta name="Description" content="大写属性名">')).desc, '大写属性名');
});

test('extractMeta 的优先级：meta description > og:description > twitter:description', () => {
  const both = extractMeta(
    page('<meta property="og:description" content="OG"><meta content="普通" name="description">'),
  );
  assert.equal(both.desc, '普通');
  assert.equal(both.source, 'description');

  const twitter = extractMeta(page('<meta name="twitter:description" content="TW">'));
  assert.equal(twitter.desc, 'TW');
  assert.equal(twitter.source, 'og');

  const empty = extractMeta(page('<meta name="description" content="  "><meta property="og:description" content="OG">'));
  assert.equal(empty.desc, 'OG');
});

test('extractMeta 去掉内嵌标签、截断超长文本', () => {
  assert.equal(extractMeta(page('<title>A <b>B</b></title>')).title, 'A B');
  assert.equal(extractMeta(page('<title>a&lt;b&gt;c</title>')).title, 'a<b>c');
  assert.equal(extractMeta(page(`<title>${'x'.repeat(200)}</title>`)).title.length, 80);
  assert.equal(extractMeta(page(`<meta name="description" content="${'y'.repeat(300)}">`)).desc.length, 120);
});

test('extractMeta 对空输入与坏输入不抛异常', () => {
  for (const input of ['', null, undefined, '<html>', '<title>', '<meta name=description>']) {
    const meta = extractMeta(input);
    assert.equal(typeof meta.title, 'string');
    assert.equal(typeof meta.desc, 'string');
  }
  assert.equal(extractMeta('').title, '');
});
