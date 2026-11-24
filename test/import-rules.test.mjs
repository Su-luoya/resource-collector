import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBookmarks } from '../src/lib/bookmarks-html.mjs';
import { suggestFor } from '../src/lib/link-rules.mjs';

const taxonomy = JSON.parse(readFileSync(new URL('../src/data/taxonomy.json', import.meta.url), 'utf8'));

const SAMPLE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000">金融</H3>
    <DL><p>
        <DT><A HREF="https://arxiv.org/abs/1234" ADD_DATE="1700000001">A Paper &amp; Notes</A>
        <DD>comment
        <DT><A HREF="javascript:void(0)">Bad</A>
        <DT><A HREF="https://arxiv.org/abs/1234">Dup</A>
    </DL><p>
    <DT><H3>工具</H3>
    <DT><A HREF="https://pypi.org/project/x"><B>pypi</B> package</A>
</DL><p>`;

test('书签文件：抽出 URL、标题与所在文件夹，解实体、去重复、跳过非 http', () => {
  const { items, skipped } = parseBookmarks(SAMPLE);
  assert.deepEqual(items, [
    { url: 'https://arxiv.org/abs/1234', title: 'A Paper & Notes', folder: '金融' },
    { url: 'https://pypi.org/project/x', title: 'pypi package', folder: '工具' },
  ]);
  assert.equal(skipped, 1);
});

test('书签文件：空输入不炸', () => {
  assert.deepEqual(parseBookmarks(''), { items: [], skipped: 0, total: 0 });
  assert.deepEqual(parseBookmarks(undefined).items, []);
});

test('域名规则命中平台，并给出词表内的取值', () => {
  const pypi = suggestFor('https://pypi.org/project/numpy/', taxonomy);
  assert.equal(pypi.section[0], 'packages');
  assert.deepEqual(pypi.facets.packages, { lang: ['python'], kind: 'pkg' });

  const arxiv = suggestFor('https://arxiv.org/abs/1234', taxonomy);
  assert.deepEqual(arxiv.facets.nav, { kind: 'paper' });

  // 子域也算命中
  assert.equal(suggestFor('https://docs.pypi.org/x', taxonomy).matched, 'pypi.org');

  // github 只给分区，不猜形态
  const gh = suggestFor('https://github.com/a/b', taxonomy);
  assert.deepEqual(gh.section, ['packages']);
  assert.deepEqual(gh.facets, {});
});

test('域名规则：未收录的域名返回 null，词表里删掉的取值会被丢弃并记下', () => {
  assert.equal(suggestFor('https://sydneyludvigson.com/', taxonomy), null);
  assert.equal(suggestFor('not a url', taxonomy), null);

  const trimmed = {
    sections: taxonomy.sections.map((s) =>
      s.id === 'nav' ? { ...s, facets: s.facets.map((f) => ({ ...f, values: f.values.filter((v) => v.id !== 'paper') })) } : s,
    ),
  };
  const arxiv = suggestFor('https://arxiv.org/abs/1', trimmed);
  assert.deepEqual(arxiv.facets, {});
  assert.deepEqual(arxiv.dropped, ['nav.kind=paper']);
});
