import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBookmarks, tidyTitle } from '../src/lib/bookmarks-html.mjs';

const BROWSER_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 ADD_DATE="1700000000">论文</H3>
  <DL><p>
    <DT><A HREF="https://arxiv.org/abs/2401.00001" ADD_DATE="1700000001">A Paper - arXiv</A>
    <DT><A HREF="javascript:alert(1)" ADD_DATE="1700000002">坏书签</A>
    <DT><A HREF="https://arxiv.org/abs/2401.00001" ADD_DATE="1700000003">同一个链接又来一次</A>
  </DL><p>
  <DT><H3>工具</H3>
  <DL><p>
    <DT><A HREF="https://pypi.org/project/pandas/">pandas &amp; friends</A>
  </DL><p>
</DL><p>`;

test('解析浏览器书签：取标题/地址/文件夹，解实体，跳过非 http，重复静默去掉', () => {
  const { items, skipped, total } = parseBookmarks(BROWSER_EXPORT);
  assert.equal(total, 4);
  assert.equal(skipped, 1);
  assert.deepEqual(items, [
    { url: 'https://arxiv.org/abs/2401.00001', title: 'A Paper - arXiv', folder: '论文' },
    { url: 'https://pypi.org/project/pandas/', title: 'pandas & friends', folder: '工具' },
  ]);
});

test('不是书签文件时返回空结果，而不是抛错', () => {
  assert.deepEqual(parseBookmarks('<html><body>hello</body></html>').items, []);
  assert.deepEqual(parseBookmarks(''), { items: [], skipped: 0, total: 0 });
  assert.deepEqual(parseBookmarks(undefined).items, []);
});

test('标题去掉站点后缀；空标题退回域名，不留空字符串', () => {
  assert.equal(tidyTitle('Some Paper - arXiv', 'https://arxiv.org/abs/1'), 'Some Paper');
  assert.equal(tidyTitle('', 'https://www.example.com/x'), 'example.com');
  assert.equal(tidyTitle('   ', 'https://example.com'), 'example.com');
  assert.equal(tidyTitle('A · B | C', 'https://example.com'), 'A · B');
});
