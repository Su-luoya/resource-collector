import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightPattern, highlightPieces, queryMatcher } from '../src/client/search.ts';

test('搜索词可以跨字段、换序，但必须全部命中', () => {
  const card = 'pyfixest skills 多重固定效应回归 包与文档 python';
  assert.ok(queryMatcher('  PYTHON　 固定效应  ')(card));
  assert.ok(queryMatcher('固定效应	Python')(card));
  assert.ok(queryMatcher('PyFix')(card));
  assert.ok(queryMatcher('  ')(card));
  assert.equal(queryMatcher('Python 面板数据')(card), false);
});

test('高亮只切命中片段，未命中时原样返回', () => {
  const pattern = highlightPattern('PYTHON 固定');
  assert.ok(pattern);
  const pieces = highlightPieces('Python 面板数据 固定效应', pattern);
  assert.deepEqual(
    pieces.map((p) => `${p.hit ? '[' : ''}${p.text}${p.hit ? ']' : ''}`).join(''),
    '[Python] 面板数据 [固定]效应',
  );

  // 没有查询词时不做任何切分
  assert.deepEqual(highlightPieces('abc', highlightPattern('  ')), [{ text: 'abc', hit: false }]);
  // 正则元字符按字面匹配，不能当成语法
  assert.deepEqual(
    highlightPieces('a.b', highlightPattern('a.b')).map((p) => p.text),
    ['a.b'],
  );
  assert.equal(highlightPattern('a.b').test('axb'), false);
});
