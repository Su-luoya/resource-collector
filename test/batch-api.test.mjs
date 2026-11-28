// dev 期三个新接口的端到端测试：`npm test`
//
// 覆盖 api/duplicates（相似候选 + 跟踪参数建议）、api/batch-meta（只抓草稿不写盘）、
// api/batch-add（整批校验后一次写入）与 api/publish-preview（发布前结构化差异）。
// 所有抓取与云端写入都指向本地 fixture。
import { test } from 'node:test';
import { startFakeCloud } from './helpers/cloud.mjs';
import { readCache, writeCache } from '../src/lib/cloud-sync.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dev } from 'astro';
import { runTask } from './helpers/task.mjs';

test('批量导入、相似候选与发布前差异：都只经 dev 接口，写盘一次到位', async (t) => {
  const root = process.cwd();
  const scratch = join(root, '.scratch');
  mkdirSync(scratch, { recursive: true });
  const tmp = mkdtempSync(join(scratch, 'batch-api-'));
  const repo = join(tmp, 'work');
  mkdirSync(repo);
  process.chdir(repo);
  t.after(() => {
    process.chdir(root);
    rmSync(tmp, { recursive: true, force: true });
  });
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    ASTRO_TELEMETRY_DISABLED: '1',
    ASTRO_DISABLE_UPDATE_CHECK: 'true',
    TMPDIR: tmp,
  });

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
  ]) {
    cpSync(join(root, file), file);
  }
  writeFileSync('src/pages/index.astro', 'fixture');
  writeFileSync('public/icons/.gitkeep', '');
  const entry = (title, url) => ({
    title,
    url,
    section: ['tools'],
    facets: { tools: { kind: 'tool' } },
    desc: title,
    added: '2026-01-01',
  });
  // 数据源现在是云端：缓存 = 读，published.json = 「上一次发布时的样子」
  const seed = [entry('A', 'https://a.example.com/p'), entry('B', 'https://b.example.com/')];
  writeCache({ links: seed, status: [], icons: {}, syncedAt: new Date().toISOString() });
  writeFileSync('.cache/published.json', JSON.stringify({ links: seed, at: new Date().toISOString() }));
  const cloud = await startFakeCloud({ links: seed });
  cloud.use();
  t.after(() => cloud.close());
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('add', '-A');
  git('commit', '-m', 'seed');

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
    const urls = () => readCache().links.map((row) => row.url);

    // 相似候选：清理建议与候选都只读不写。
    const dup = await api('duplicates', { url: 'https://a.example.com/p/?utm_source=x' });
    assert.equal(dup.ok, true);
    assert.deepEqual(dup.cleanup, { url: 'https://a.example.com/p/', removed: ['utm_source'] });
    assert.equal(dup.candidates[0].reason, '清理跟踪参数后相同');
    assert.equal(urls().length, 2);

    // 新增时「完全重复」必须报出来；否则用户以为库里没有，保存时才被 409 拦住。
    const exact = await api('duplicates', { url: 'https://a.example.com/p', title: 'A' });
    assert.equal(exact.candidates[0].reason, 'URL 已存在');

    // 编辑时排除自身，不会把自己报成重复。
    const self = await api('duplicates', {
      url: 'https://a.example.com/p',
      excludeUrl: 'https://a.example.com/p',
      title: 'A',
    });
    assert.deepEqual(self.candidates, []);

    // batch-meta：跳过分支不上网，也不写文件。
    const skippedOnly = await runTask(server.address.port, 'batch-meta', {
      urls: ['not a url', 'https://a.example.com/p', 'https://a.example.com/p'],
    });
    assert.equal(skippedOnly.ok, true);
    assert.deepEqual(skippedOnly.drafts, []);
    assert.match(skippedOnly.skipped[0].reason, /空白/);
    assert.deepEqual(skippedOnly.skipped.slice(1).map((item) => item.reason), ['库中已存在', '本批重复']);

    const failedMeta = await runTask(server.address.port, 'batch-meta', { urls: [cloud.url + '/missing'] });
    assert.match(failedMeta.drafts[0].hint, /404/);
    assert.equal(failedMeta.drafts[0].note, undefined, '抓取提示不是用户笔记');

    const tooMany = await api('batch-meta', { urls: Array.from({ length: 21 }, (_, i) => `https://x${i}.example.com`) });
    assert.equal(tooMany.http, 400);
    assert.match(tooMany.message, /最多 20 条/);

    // batch-add：先干跑校验，失败时一个字节都不写。
    const draft = (url, patch = {}) => ({
      title: url.replace(/\W/g, '').slice(0, 20) || 'C',
      url,
      section: ['tools'],
      facets: { tools: { kind: 'tool' } },
      desc: '示例',
      added: '2026-01-01',
      ...patch,
    });
    const bad = await api('batch-add', {
      rows: [draft('https://c.example.com', { section: ['nope'] })],
      dryRun: true,
    });
    assert.equal(bad.http, 400);
    assert.match(bad.errors.join('\n'), /section/);
    assert.equal(urls().length, 2);

    const dry = await api('batch-add', { rows: [draft('https://c.example.com')], dryRun: true });
    assert.deepEqual({ ok: dry.ok, message: dry.message }, { ok: true, message: '草稿有效' });
    assert.equal(urls().length, 2);

    const clash = await api('batch-add', { rows: [draft('https://a.example.com/p')], dryRun: true });
    assert.equal(clash.http, 409);

    const missingDesc = await api('batch-add', { rows: [draft('https://d.example.com', { desc: ' ' })], dryRun: true });
    assert.equal(missingDesc.http, 400);
    assert.match(missingDesc.message, /简介不能为空/);

    const written = await api('batch-add', {
      rows: [draft('https://c.example.com', { read: false }), draft('https://d.example.com')],
    });
    assert.equal(written.ok, true, written.message);
    const saved = readCache().links.find((row) => row.url === 'https://c.example.com/');
    assert.equal(saved.read, false);
    assert.deepEqual(urls(), [
      'https://a.example.com/p',
      'https://b.example.com/',
      'https://c.example.com/',
      'https://d.example.com/',
    ]);
    assert.ok(!existsSync('.cache/links.yaml'), '不该再有 YAML 了');

    // 发布前预览：结构化列出新增，而不是只给个数。
    const preview = await api('publish-preview');
    assert.equal(preview.ok, true);
    assert.deepEqual(preview.added.map((row) => row.url), ['https://c.example.com/', 'https://d.example.com/']);
    assert.deepEqual(preview.removed, []);
    assert.deepEqual(preview.changed, []);

    // 改一条 URL：同名唯一时算「修改」，不是删一条加一条。
    const moved = await api('edit', {
      action: 'update',
      url: 'https://b.example.com/',
      newUrl: 'https://b2.example.com',
    });
    assert.equal(moved.ok, true, moved.message);
    const after = await api('publish-preview');
    assert.equal(after.changed.length, 1);
    assert.equal(after.changed[0].before.url, 'https://b.example.com/');
    assert.equal(after.changed[0].after.url, 'https://b2.example.com/');
    assert.deepEqual(after.removed, []);

    await t.test('书签预览只把分类齐全的草稿标为可导入；确认不需要原文件', async () => {
      const html = '<DT><A HREF="https://arxiv.org/abs/1?a=1&amp;b=2">论文</A>' +
        '<DT><A HREF="https://github.com/example/tool">项目</A>';
      const imported = await api('import-bookmarks', { html });
      assert.equal(imported.ok, true);
      assert.equal(urls().length, 4, '预览不写库');
      const saved = await api('import-bookmarks', { commit: true, rows: [imported.drafts[0]] });
      assert.equal(saved.ok, true, saved.message);
      assert.deepEqual(imported.drafts.map((r) => r.ready), [true, false]);
      const paper = readCache().links.find((r) => r.url === 'https://arxiv.org/abs/1?a=1&b=2');
      assert.equal(paper?.read, false);
      assert.deepEqual(paper.section, ['lit']);
      assert.equal((await api('import-bookmarks', { commit: true, rows: [imported.drafts[1]] })).http, 400);
    });
  } finally {
    await server.stop();
  }
});
