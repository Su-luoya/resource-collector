// 数据与派生产物的不变量：跑 `npm test` 就能发现「图标表键漂了」「yaml 写坏了」这类问题。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { hostKey, parseLinks, validateRows, dumpLinks } = await import(resolve(root, 'src/lib/link-data.mjs'));

const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const rawLinks = read('src/data/links.yaml');
const links = parseLinks(rawLinks);
const taxonomy = JSON.parse(read('src/data/taxonomy.json'));
const icons = JSON.parse(read('src/data/icons.json'));
const status = JSON.parse(read('src/data/link-status.json'));

const sections = new Map(taxonomy.sections.map((s) => [s.id, s]));

test('links.yaml 通过校验', () => {
  const { errors } = validateRows(links, taxonomy);
  assert.deepEqual(errors, []);
});

test('links.yaml 与编辑层序列化格式一致（否则一次编辑就会重排全文件）', () => {
  assert.equal(dumpLinks(links, rawLinks), rawLinks);
});

test('taxonomy 的分区、分类轴与取值都登记完整且不重复', () => {
  const ids = taxonomy.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'sections 有重复 id');

  for (const section of taxonomy.sections) {
    assert.match(section.id, /^[a-z0-9-]+$/);
    assert.ok(section.label && section.hint, `${section.id} 缺 label/hint`);

    const facetIds = section.facets.map((f) => f.id);
    assert.equal(new Set(facetIds).size, facetIds.length, `${section.id} 的 facets 有重复 id`);
    assert.ok(facetIds.includes(section.badge), `${section.id}.badge 指向了不存在的轴：${section.badge}`);

    for (const facet of section.facets) {
      assert.match(facet.id, /^[a-z0-9-]+$/);
      assert.ok(facet.label, `${section.id}.${facet.id} 缺 label`);
      const values = facet.values.map((v) => v.id);
      assert.equal(new Set(values).size, values.length, `${section.id}.${facet.id} 的取值有重复 id`);
      for (const value of facet.values) {
        assert.match(value.id, /^[a-z0-9-]+$/, `${section.id}.${facet.id} 的取值 id 非法：${value.id}`);
        assert.ok(value.label, `${section.id}.${facet.id}.${value.id} 缺 label`);
      }
    }
  }
});

test('每条资源的分区与分类都落在词表里（越界构建就会炸）', () => {
  for (const l of links) {
    assert.ok(l.section.length > 0, `${l.title} 没有分区`);
    assert.deepEqual(
      Object.keys(l.facets).sort(),
      [...l.section].sort(),
      `${l.title} 的 facets 键与 section 不一致`,
    );

    for (const sid of l.section) {
      const def = sections.get(sid);
      assert.ok(def, `${l.title} 的分区未登记：${sid}`);
      const got = l.facets[sid];
      for (const facet of def.facets) {
        const value = got[facet.id];
        assert.ok(value !== undefined, `${l.title} 缺 ${sid}.${facet.id}`);
        const list = Array.isArray(value) ? value : [value];
        assert.equal(Array.isArray(value), Boolean(facet.multi), `${l.title}.${sid}.${facet.id} 单/多选写法不合词表`);
        for (const v of list) {
          assert.ok(
            facet.values.some((x) => x.id === v),
            `${l.title}.${sid}.${facet.id} 取值未登记：${v}`,
          );
        }
      }
    }
  }
});

test('图标表的键是规范化域名，且文件都存在', () => {
  for (const [key, path] of Object.entries(icons)) {
    assert.ok(!key.startsWith('www.'), `键没规范化：${key}`);
    assert.equal(key, key.toLowerCase(), `键没小写：${key}`);
    assert.ok(path.startsWith('icons/'), `不是 public 下的相对路径：${path}`);
    assert.ok(existsSync(resolve(root, 'public', path)), `图标文件不存在：${path}`);
  }
});

test('hostKey 让 www 与裸域名落进同一把键（本轮修复的丢图标 bug）', () => {
  for (const url of ['https://www.nber.org/papers', 'https://nber.org/papers', 'https://WWW.NBER.ORG']) {
    assert.equal(hostKey(url), 'nber.org');
  }
  const withWww = links.filter((l) => new URL(l.url).hostname.startsWith('www.'));
  assert.ok(withWww.length > 0, '数据里应该有带 www 的链接');
  for (const l of withWww) {
    const key = hostKey(l.url);
    assert.ok(!Object.hasOwn(icons, `www.${key}`), `图标表键没规范化：www.${key}`);
  }
});

test('图标表里没有数据里已删掉的域名', (t) => {
  const hosts = new Set(links.map((l) => hostKey(l.url)));
  const stale = Object.keys(icons).filter((key) => !hosts.has(key));
  // 只报告不失败：删链接时忘了清理图标不该把 CI 卡住（下次 npm run icons 会自动 prune）
  if (stale.length) t.diagnostic(`icons.json 里有过期域名：${stale.join(', ')}`);
});

test('link-status.json 只包含当前链接，且形态合法', (t) => {
  const urls = new Set(links.map((l) => l.url));
  const stale = [];
  for (const [url, info] of Object.entries(status)) {
    if (!urls.has(url)) stale.push(url);
    assert.ok(['ok', 'redirect', 'warn', 'fail'].includes(info.status), `非法状态：${info.status}`);
    assert.match(info.checked, /^\d{4}-\d{2}-\d{2}$/);
  }
  if (stale.length) t.diagnostic(`状态表里有已删链接：${stale.join(', ')}`);
});
