import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNote } from '../src/lib/note.mjs';

test('空笔记渲染成空串，详情页据此不显示笔记区块', () => {
  assert.equal(renderNote(''), '');
  assert.equal(renderNote('   \n\n '), '');
  assert.equal(renderNote(null), '');
});

test('空行分段、连续 - 开头成列表', () => {
  const html = renderNote('第一段\n\n第二段\n\n- 甲\n- 乙');
  assert.match(html, /<p>第一段<\/p>/);
  assert.match(html, /<p>第二段<\/p>/);
  assert.match(html, /<ul><li>甲<\/li><li>乙<\/li><\/ul>/);
});

test('粗体、行内代码、链接都认，链接只开 http(s)', () => {
  const html = renderNote('**重点** 和 `code` 和 [官方](https://example.com/a?b=1)');
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /href="https:\/\/example.com\/a\?b=1"/);
  assert.match(html, /target="_blank"/);
});

test('javascript: 与裸标签都会转义，不会变成可执行结构', () => {
  const html = renderNote('[点我](javascript:alert(1)) <script>alert(2)</script>');
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('属性里的引号被转义，不能借笔记注入属性', () => {
  const html = renderNote('[x](https://example.com/"onmouseover="alert(1))');
  assert.doesNotMatch(html, /onmouseover="alert/);
});

test('链接地址里的星号、以及代码片段里的链接，都不会被当成格式', () => {
  const html = renderNote('[x](https://example.com/a*b*c) 与 \`[y](https://example.com/z)\`');
  assert.match(html, /href="https:\/\/example.com\/a\*b\*c"/, '地址原样进 href');
  assert.doesNotMatch(html, /<strong>/, '地址里的星号不该变成粗体');
  assert.match(html, /<code>\[y\]\(https:\/\/example.com\/z\)<\/code>/, '代码片段里不生成链接');
  assert.equal((html.match(/<a /g) ?? []).length, 1);
});

