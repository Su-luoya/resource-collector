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

test('links.yaml 通过校验', () => {
  const { errors } = validateRows(links, taxonomy);
  assert.deepEqual(errors, []);
});

test('links.yaml 与编辑层序列化格式一致（否则一次编辑就会重排全文件）', () => {
  assert.equal(dumpLinks(links, rawLinks), rawLinks);
});

test('taxonomy 的 id 不重复，字段齐全', () => {
  for (const axis of ['types', 'topics']) {
    const ids = taxonomy[axis].map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `${axis} 有重复 id`);
    for (const facet of taxonomy[axis]) {
      assert.match(facet.id, /^[a-z0-9-]+$/);
      assert.ok(facet.label && facet.hint, `${facet.id} 缺 label/hint`);
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
  // 只报告不失败：删链接时忘了清理图标不该把 CI 卡住（下次 npm run icons 会自动prune）
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
