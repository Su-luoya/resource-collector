import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownItem } from '../src/client/markdown.ts';

test('一条资源生成一行 Markdown 列表，保留原网址的查询与锚点', () => {
  assert.equal(markdownItem(' Tidy Finance ', 'https://example.org/?lang=zh&part=2#data', 'R 与 Python\n实证教程。'),
    '- [Tidy Finance](https://example.org/?lang=zh&part=2#data) — R 与 Python 实证教程。');
});

test('标题、简介中的标记保持为文字，网址中的右括号不会提前截断链接', () => {
  assert.equal(markdownItem('A [R] \\ B', 'https://example.org/a)b?raw=&amp;', '*指南* 和 <示例>'),
    '- [A \\[R\\] \\\\ B](https://example.org/a\\)b?raw=\\&amp;) — \\*指南\\* 和 \\<示例\\>');
});
