import { test } from 'node:test';
import { startFakeCloud } from './helpers/cloud.mjs';
import { readCache, refreshCache } from '../src/lib/cloud-sync.mjs';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { dev } from 'astro';
import { editPayload } from '../src/dev/editor-shared.ts';

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
  ]) {
    cpSync(join(root, file), file);
  }
  writeFileSync('src/pages/index.astro', 'fixture');
  const link = (title, url) => ({ title, url, section: ['tools'], facets: { tools: { kind: 'tool' } }, desc: title, added: '2026-01-01' });
  const cloud = await startFakeCloud({
    links: [link('Redirect', redirect), link('Failed', failed), link('Warn', warn), link('Occupied', occupied)],
    status: [
      { url: redirect, status: 'redirect', code: 200, target: final, checked: '2026-08-01' },
      { url: failed, status: 'fail', code: 404, checked: '2026-08-01' },
      { url: warn, status: 'warn', code: 403, checked: '2026-08-01' },
    ],
  });
  cloud.use();
  t.after(() => cloud.close());
  await refreshCache();

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
    // 复查只刷新一条，但返回的必须仍是整张维护列表（失败的那条不能被这次复查抹掉）
    assert.deepEqual(rechecked.tasks.map((task) => task.kind), ['fail', 'redirect']);
    assert.equal(rechecked.tasks[0].row.url, failed);
    assert.match(rechecked.tasks[1].reason, /临时/);

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
    // 只剩「打不开」那条；新地址体检通过，不再是待办
    assert.deepEqual(ok.tasks.map((task) => task.kind), ['fail']);
    assert.equal(ok.tasks[0].row.url, failed);

    const duplicate = await api('edit', { action: 'update', url: final, newUrl: occupied });
    assert.equal(duplicate.http, 409);
    assert.ok(urls().includes(final));
    assert.equal(urls().filter((url) => url === occupied).length, 1);

    // 笔记与待看：部分字段的更新不能把它们洗掉（之前就踩过「编辑冲掉可选字段」的坑）
    const rowNow = () => readCache().links.find((row) => row.url === final);
    assert.equal((await api('edit', { action: 'update', url: final, note: '- 结论：留着', read: false })).ok, true);
    assert.equal(rowNow().note, '- 结论：留着');
    assert.equal(rowNow().read, false);
    // 只改标题，note/read 必须守恒
    assert.equal((await api('edit', { action: 'update', url: final, title: '改个名字' })).ok, true);
    assert.equal(rowNow().note, '- 结论：留着');
    assert.equal(rowNow().read, false);
    // 传空笔记与 read:true：缓存里不再带可选字段
    const opened = rowNow();
    const { note, read, ...cleared } = opened;
    assert.equal((await api('edit', editPayload(opened, cleared))).ok, true);
    assert.equal(rowNow().note, undefined);
    assert.equal(rowNow().read, undefined);

    await t.test('缓存落后时，不覆盖云端新增、未编辑的列或已经占用的新地址', async () => {
      const occupiedLater = origin + '/taken';
      cloud.tables.links.set(occupiedLater, link('云端新增', occupiedLater));
      const add = await api('edit', { ...link('不能覆盖', occupiedLater), action: 'add' });
      const move = await api('edit', { action: 'update', url: final, newUrl: occupiedLater });
      assert.equal(add.ok, false);
      assert.equal(move.ok, false);
      assert.equal(cloud.tables.links.get(occupiedLater).title, '云端新增');
      assert.ok(urls().includes(final));
      cloud.tables.links.delete(occupiedLater);
      const before = rowNow();
      cloud.tables.links.get(final).note = '云端笔记';
      await refreshCache();
      const change = editPayload(before, { ...before, title: '本地标题' });
      assert.deepEqual(change, { action: 'update', url: final, title: '本地标题' });
      assert.equal((await api('edit', change)).ok, true);
      assert.equal(rowNow().note, '云端笔记');
    });

    await t.test('只改路径末尾斜杠也要原地改主键、保留体检，不产生两条', async () => {
      const before = rowNow();
      const edited = await api('edit', editPayload(before, { ...before, url: final + '/' }));
      assert.equal(edited.ok, true, edited.message);
      assert.ok(!urls().includes(final));
      assert.ok(urls().includes(final + '/'));
      assert.equal(statuses()[final + '/']?.status, 'ok');
      assert.equal(readCache().links.length, 4);
    });

    const removed = await api('edit', { action: 'delete', url: failed });
    assert.equal(removed.ok, true, removed.message);
    assert.equal(statuses()[failed], undefined);
    assert.deepEqual((await api('maintenance')).tasks, []);

    // 行已经写成、体检状态没清掉：不能报成「写库失败」，否则用户会去重试一件已经完成的事
    // （重试时旧地址已经不在了，只会拿到 404）
    const moved = `${origin}/warn-moved`;
    cloud.tables.link_status.set(warn, { url: warn, status: 'warn', code: 403, checked: '2026-08-01' });
    cloud.failNext('DELETE', 'link_status', 500);
    const partial = await api('edit', { action: 'update', url: warn, newUrl: moved });
    assert.equal(partial.ok, true, partial.message);
    assert.equal(partial.http, 200);
    assert.match(partial.message, /体检状态没清掉/);
    assert.ok(urls().includes(moved), '行必须已经写进去');
    assert.ok(!urls().includes(warn), '旧地址已经不在了');
    assert.equal(statuses()[warn], undefined);
    assert.equal(statuses()[moved]?.status, 'warn', '清理失败时，外键仍跟着新地址');
    assert.equal((await api('edit', { action: 'delete', url: moved })).ok, true);
  } finally {
    await server.stop();
    await new Promise((resolve) => target.close(resolve));
  }
});
