// `npm test`：发布 = 同步 → 补图标 → 触发 Actions 重建。
//
// 这条链上没有 git commit/push 了，所以这里钉的是：校验不过就中止、图标步骤能算出 N/N、
// 以及「触发重建」调用的确实是 workflow run。gh 用 GH_BIN 换成假脚本，避免真去发包。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dev } from 'astro';
import { startFakeCloud } from './helpers/cloud.mjs';
import { refreshCache, readCache } from '../src/lib/cloud-sync.mjs';
import { runTask } from './helpers/task.mjs';

const row = (title, url, patch = {}) => ({
  title,
  url,
  section: ['tools'],
  facets: { tools: { kind: 'tool' } },
  desc: title,
  added: '2026-01-01',
  ...patch,
});

test('发布：校验不过就中止；过了则同步、补图标并触发一次重建', async (t) => {
  const root = process.cwd();
  const scratch = join(root, '.scratch');
  mkdirSync(scratch, { recursive: true });
  const tmp = mkdtempSync(join(scratch, 'publish-'));
  const repo = join(tmp, 'work');
  mkdirSync(repo);
  process.chdir(repo);
  const cloud = await startFakeCloud({
    links: [row('A', 'https://a.example.com/p'), row('B', 'https://b.example.com/')],
    // 两个域名都是「刚失败过」，图标步骤会直接跳过，不联网
    icons: [
      { host: 'a.example.com', file: null, missed_at: new Date().toISOString() },
      { host: 'b.example.com', file: null, missed_at: new Date().toISOString() },
    ],
  });
  cloud.use();
  const ghCalls = join(repo, '.gh-calls');
  const fakeGh = join(tmp, 'gh');
  writeFileSync(fakeGh, `#!/bin/sh\necho "$@" >> "${ghCalls}"\nexit 0\n`, { mode: 0o755 });
  process.env.GH_BIN = fakeGh;
  t.after(async () => {
    process.chdir(root);
    await cloud.close();
    delete process.env.GH_BIN;
    rmSync(tmp, { recursive: true, force: true });
  });
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];

  for (const dir of ['src/pages', 'src/lib', 'src/data', 'public/icons']) mkdirSync(dir, { recursive: true });
  for (const file of [
    'src/middleware.ts',
    'src/lib/dev-meta.mjs',
    'src/lib/http-body.mjs',
    'src/lib/link-data.mjs',
    'src/lib/cloud.mjs',
    'src/lib/cloud-sync.mjs',
    'src/lib/storage.mjs',
    'src/lib/link-maintenance.mjs',
    'src/lib/link-quality.mjs',
    'src/lib/dev-task.mjs',
    'src/lib/icon-cache.mjs',
    'src/lib/ai-draft.mjs',
    'src/lib/link-rules.mjs',
    'src/lib/bookmarks-html.mjs',
    'src/data/taxonomy.json',
    'scripts/fetch-icons.mjs',
  ]) {
    cpSync(join(root, file), file);
  }
  writeFileSync('src/pages/index.astro', 'fixture');
  writeFileSync('public/icons/.gitkeep', '');
  await refreshCache();
  assert.equal(readCache().links.length, 2);

  const server = await dev({ root: repo, configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  t.after(() => server.stop());
  const port = server.address.port;

  // 1) 校验不过：任务失败，且不会触发重建
  cloud.tables.links.set('https://c.example.com/', row('C', 'https://c.example.com/', { section: [] }));
  const stopped = await runTask(port, 'publish');
  assert.equal(stopped.ok, false);
  assert.match(stopped.message, /校验未通过/);
  assert.equal(existsSync(ghCalls), false);
  cloud.tables.links.delete('https://c.example.com/');

  // 2) 正常发布：三步都过，gh 收到的是 workflow run deploy.yml
  cloud.tables.icons.set('a.example.com', { host: 'a.example.com', file: 'icons/a.ico' });
  writeFileSync('public/icons/a.ico', 'fixture');
  const seen = [];
  const done = await runTask(port, 'publish', {}, { onSnapshot: (task) => seen.push(task.status) });
  assert.equal(done.ok, true, done.message);
  assert.match(done.message, /已触发重建/);
  assert.ok(seen.includes('running'), '应该能看到 running 快照，否则前端没有进度可轮询');
  const calls = readFileSync(ghCalls, 'utf8').trim();
  assert.match(calls, /^workflow run deploy\.yml --ref master$/m);
  // 发布成功会记下「已上线」的快照，下次用它算差异
  assert.ok(existsSync('.cache/published.json'));
  const snapshot = JSON.parse(readFileSync('.cache/published.json', 'utf8'));
  const get = async (route) => (await fetch(`http://127.0.0.1:${port}/api/${route}`)).json();
  await t.test('发布快照包括云端图标；仅图标变化也能发布', async () => {
    assert.deepEqual(snapshot.icons, { 'a.example.com': 'icons/a.ico' });
    assert.equal((await get('status')).dirty, false);
    writeFileSync('.cache/published.json', JSON.stringify({ ...snapshot, icons: {} }));
    assert.deepEqual((await get('publish-preview')).icons, ['+ a.example.com']);
    assert.equal((await get('status')).dirty, true);
  });
  await t.test('已有链接第一次体检也进预览和待发布状态', async () => {
    writeFileSync('.cache/published.json', JSON.stringify(snapshot));
    const url = 'https://a.example.com/p';
    cloud.tables.link_status.set(url, { url, status: 'ok', code: 200, checked: '2026-01-01' });
    await refreshCache();
    assert.equal((await get('publish-preview')).statusChanged, true);
    assert.equal((await get('status')).dirty, true);
  });
  await t.test('远端拒绝触发不改快照，同一份数据可以重新触发', async () => {
    const baseline = readFileSync('.cache/published.json', 'utf8');
    writeFileSync(fakeGh, '#!/bin/sh\nexit 1\n');
    const refused = await runTask(port, 'publish');
    assert.equal(refused.ok, false);
    assert.equal(readFileSync('.cache/published.json', 'utf8'), baseline);
    writeFileSync(fakeGh, '#!/bin/sh\nexit 0\n');
    assert.equal((await runTask(port, 'publish')).ok, true);
    assert.equal((await get('status')).dirty, false);
    assert.equal((await runTask(port, 'publish')).ok, true);
  });
  assert.equal(readCache().links.length, 2);
});
