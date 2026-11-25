import { test } from 'node:test';
import { startFakeCloud } from './helpers/cloud.mjs';
import { readCache, writeCache } from '../src/lib/cloud-sync.mjs';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { dev } from 'astro';
import { parseLinks } from '../src/lib/link-data.mjs';

test('dev 维护闭环：fail 优先、单条复查、URL 更新去重、状态同步与删除清理', async (t) => {
  const root = process.cwd();
  const scratch = join(root, '.scratch');
  mkdirSync(scratch, { recursive: true });
  const tmp = mkdtempSync(join(scratch, 'maintenance-api-'));
  const repo = join(tmp, 'work');
  mkdirSync(repo);
  process.chdir(repo);
  t.after(() => {
    process.chdir(root);
    rmSync(tmp, { recursive: true, force: true });
  });
  Object.assign(process.env, {
    ASTRO_TELEMETRY_DISABLED: '1',
    ASTRO_DISABLE_UPDATE_CHECK: 'true',
    TMPDIR: tmp,
  });

  const target = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/final' });
      res.end();
    } else if (req.url === '/final') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    } else if (req.url === '/warn') {
      res.writeHead(403);
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const address = target.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const redirect = `${origin}/redirect`;
  const final = `${origin}/final`;
  const failed = `${origin}/gone`;
  const warn = `${origin}/warn`;
  const occupied = 'https://occupied.example.com/';

  for (const dir of ['src/pages', 'src/lib', 'src/data']) mkdirSync(dir, { recursive: true });
  for (const file of [
    'src/middleware.ts',
    'src/lib/dev-meta.mjs',
    'src/lib/link-data.mjs',
    'src/lib/cloud.mjs',
    'src/lib/cloud-sync.mjs',
    'src/lib/link-maintenance.mjs',
    'src/lib/link-quality.mjs',
    'src/lib/dev-task.mjs',
    'src/lib/icon-cache.mjs',
    'src/lib/ai-draft.mjs',
    'src/lib/link-rules.mjs',
    'src/lib/bookmarks-html.mjs',
    'src/data/taxonomy.json',
  ]) {
    cpSync(join(root, file), file);
  }
  writeFileSync('src/pages/index.astro', 'fixture');
  const link = (title, url) => ({ title, url, section: ['tools'], facets: { tools: { kind: 'tool' } }, desc: title, added: '2026-01-01' });
  const cloud = await startFakeCloud({ links: [link('Redirect', redirect), link('Failed', failed), link('Warn', warn), link('Occupied', occupied)] });
  cloud.use();
  t.after(() => cloud.close());
  writeCache({
    syncedAt: new Date().toISOString(),
    links: [link('Redirect', redirect), link('Failed', failed), link('Warn', warn), link('Occupied', occupied)],
    status: {
      [redirect]: { url: redirect, status: 'redirect', code: 200, final, checked: '2026-08-01' },
      [failed]: { url: failed, status: 'fail', code: 404, checked: '2026-08-01' },
      [warn]: { url: warn, status: 'warn', code: 403, checked: '2026-08-01' },
    },
    icons: {},
  });

  const server = await dev({ root: repo, configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  try {
    const api = async (name, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address.port}/api/${name}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { http: response.status, ...(await response.json()) };
    };
    const statuses = () => Object.fromEntries([...cloud.tables.link_status.values()].map((row) => [row.url, row]));
    const urls = () => cloud.urls();

    const initial = await api('maintenance');
    assert.equal(initial.ok, true);
    assert.deepEqual(initial.tasks.map((task) => task.kind), ['fail', 'redirect']);
    assert.ok(initial.tasks.every((task) => task.row && task.reason));

    const rechecked = await api('recheck', { url: redirect });
    assert.equal(rechecked.ok, true, rechecked.message);
    assert.equal(rechecked.status.status, 'redirect');
    assert.equal(rechecked.status.final, final);
    assert.deepEqual(rechecked.status.redirects, [302]);
    assert.match(rechecked.tasks[0].reason, /临时/);

    // 维护面板的一键采用只传原 URL 与 newUrl；其余字段由服务端沿用旧行。
    const adopted = await api('edit', { action: 'update', url: redirect, newUrl: final });
    assert.equal(adopted.ok, true, adopted.message);
    assert.ok(urls().includes(final));
    assert.ok(!urls().includes(redirect));
    assert.equal(statuses()[redirect], undefined);
    assert.equal(statuses()[final], undefined);
    assert.deepEqual((await api('maintenance')).tasks.map((task) => task.kind), ['fail']);

    const ok = await api('recheck', { url: final });
    assert.equal(ok.status.status, 'ok');
    assert.equal(ok.tasks.length, 0);

    const duplicate = await api('edit', { action: 'update', url: final, newUrl: occupied });
    assert.equal(duplicate.http, 409);
    assert.ok(urls().includes(final));
    assert.equal(urls().filter((url) => url === occupied).length, 1);

    // 笔记与待看：部分字段的更新不能把它们洗掉（之前 pin 就踩过这个坑）
    const rowNow = () => readCache().links.find((row) => row.url === final);
    assert.equal((await api('edit', { action: 'update', url: final, note: '- 结论：留着', read: false })).ok, true);
    assert.equal(rowNow().note, '- 结论：留着');
    assert.equal(rowNow().read, false);
    // 只改标题，note/read 必须守恒
    assert.equal((await api('edit', { action: 'update', url: final, title: '改个名字' })).ok, true);
    assert.equal(rowNow().note, '- 结论：留着');
    assert.equal(rowNow().read, false);
    // 传空笔记与 read:true：字段真的从 YAML 里消失
    assert.equal((await api('edit', { action: 'update', url: final, note: '', read: true })).ok, true);
    assert.equal(rowNow().note, undefined);
    assert.equal(rowNow().read, undefined);

    const removed = await api('edit', { action: 'delete', url: failed });
    assert.equal(removed.ok, true, removed.message);
    assert.equal(statuses()[failed], undefined);
    assert.deepEqual((await api('maintenance')).tasks, []);
  } finally {
    await server.stop();
    await new Promise((resolve) => target.close(resolve));
  }
});
