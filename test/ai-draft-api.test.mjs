// api/ai-draft 的端到端测试：`npm test`
//
// 用假 pi 二进制（PI_BIN 指向一个 sh 脚本）代替真模型，本地 http 服务当目标页，
// 所以整条链路（抓正文 → 组装提示词 → 子进程 → 解析过滤 → 与表单合并）都是真跑，且完全离线。
import { test } from 'node:test';
import { startFakeCloud } from './helpers/cloud.mjs';
import { readCache, writeCache } from '../src/lib/cloud-sync.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { dev } from 'astro';

const BODY = `这是一个宏观经济数据站。我们整理中国宏观指标，提供下载与 API 接口。所有数据按季度更新，覆盖 1990 年至今。${'补充说明。'.repeat(40)}`;
const PAGE = `<!doctype html><html><head><title>中国宏观数据站</title><meta name="description" content="宏观指标下载"></head>
<body><h1>中国宏观数据站</h1><p>${BODY}</p><script>alert('不该出现在正文里')</script></body></html>`;

// 假模型：固定输出一条真依据 + 一条编造依据，用来验证「编造的被拦下」
const FAKE_JSON = JSON.stringify({
  title: '中国宏观数据站（AI）',
  desc: '整理中国宏观指标，提供下载与 API。',
  section: ['data'],
  facets: { data: { kind: 'source', topic: ['macro'] } },
  evidence: ['这个站点由麻省理工学院维护', '我们整理中国宏观指标，提供下载与 API 接口'],
});

test('AI 生成：只读页面正文、编造依据被拦、默认不覆盖已填内容', async (t) => {
  const root = process.cwd();
  const scratch = join(root, '.scratch');
  mkdirSync(scratch, { recursive: true });
  const tmp = mkdtempSync(join(scratch, 'ai-draft-api-'));
  const repo = join(tmp, 'work');
  mkdirSync(repo);

  const page = createServer((request, response) => {
    if (request.url === '/short') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>空壳页</title></head><body><div id="app"></div></body></html>');
      return;
    }
    if (request.url !== '/doc') {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('nope');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });
  await new Promise((done) => page.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${page.address().port}`;

  const fakePi = join(tmp, 'fake-pi.sh');
  writeFileSync(fakePi, `#!/bin/sh\ncat <<'JSON'\n${FAKE_JSON}\nJSON\n`);
  chmodSync(fakePi, 0o755);
  process.env.PI_BIN = fakePi;

  process.chdir(repo);
  t.after(() => {
    process.chdir(root);
    delete process.env.PI_BIN;
    page.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  for (const dir of ['src/pages', 'src/lib', 'src/data', 'public/icons']) mkdirSync(dir, { recursive: true });
  for (const file of [
    'src/middleware.ts',
    'src/lib/dev-meta.mjs',
    'src/lib/ai-draft.mjs',
    'src/lib/link-rules.mjs',
    'src/lib/bookmarks-html.mjs',
    'src/lib/link-data.mjs',
    'src/lib/cloud.mjs',
    'src/lib/cloud-sync.mjs',
    'src/lib/link-quality.mjs',
    'src/lib/dev-task.mjs',
    'src/lib/icon-cache.mjs',
    'src/lib/link-maintenance.mjs',
    'src/data/taxonomy.json',
  ]) {
    cpSync(join(root, file), file);
  }
  writeFileSync('src/pages/index.astro', 'fixture');
  writeFileSync('public/icons/.gitkeep', '');
  const cloud = await startFakeCloud({
    links: [
      { url: 'https://a.example.com', title: 'A', section: ['tools'], facets: { tools: { kind: 'tool' } }, desc: 'A', added: '2026-01-01', unread: false },
    ],
  });
  cloud.use();
  t.after(() => cloud.close());
  writeCache({ syncedAt: new Date().toISOString(), links: await cloud.rows(), status: {}, icons: {} });

  const server = await dev({ root: repo, configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  try {
    const api = async (name, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address.port}/api/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { http: response.status, ...(await response.json()) };
    };

    // 空白表单：字段全部填上，编造的依据被丢掉并计数
    const fresh = await api('ai-draft', { url: `${origin}/doc` });
    assert.equal(fresh.http, 200);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.merged.title, '中国宏观数据站（AI）');
    assert.equal(fresh.merged.desc, '整理中国宏观指标，提供下载与 API。');
    assert.deepEqual(fresh.merged.section, ['data']);
    assert.deepEqual(fresh.merged.facets, { data: { kind: 'source', topic: ['macro'] } });
    assert.deepEqual(fresh.kept, []);
    assert.equal(fresh.unverified, 1);
    assert.deepEqual(fresh.evidence, ['我们整理中国宏观指标，提供下载与 API 接口']);
    assert.equal(fresh.final, `${origin}/doc`);
    assert.equal(typeof fresh.ms, 'number');

    // 已经手写过标题与分区：默认保留，并要求人工核对时才覆盖
    const kept = await api('ai-draft', {
      url: `${origin}/doc`,
      current: { title: '我自己写的标题', desc: '', section: ['tools'], facets: { tools: { kind: 'tool' } } },
    });
    assert.equal(kept.ok, true);
    assert.equal(kept.merged.title, '我自己写的标题');
    assert.deepEqual(kept.merged.section, ['tools']);
    assert.deepEqual(kept.merged.facets, { tools: { kind: 'tool' } });
    assert.deepEqual(kept.kept, ['标题', '分区与分类']);

    const override = await api('ai-draft', {
      url: `${origin}/doc`,
      current: { title: '我自己写的标题', desc: '', section: ['tools'], facets: { tools: { kind: 'tool' } } },
      overwrite: true,
    });
    assert.equal(override.merged.title, '中国宏观数据站（AI）');
    assert.deepEqual(override.merged.section, ['data']);

    // 纯 JS 渲染的空壳页：正文太少就明说，不让模型瞎猜
    const short = await api('ai-draft', { url: `${origin}/short` });
    assert.equal(short.http, 422);
    assert.match(short.message, /正文太少/);

    // 目标页 404 时把原因原样透出来
    const missing = await api('ai-draft', { url: `${origin}/missing` });
    assert.equal(missing.http, 422);
    assert.match(missing.message, /HTTP 404/);

    // pi 不可用：502，且不影响数据文件
    process.env.PI_BIN = join(tmp, 'no-such-pi');
    const broken = await api('ai-draft', { url: `${origin}/doc` });
    assert.equal(broken.http, 502);
    assert.match(broken.message, /调用 pi 失败/);

    assert.equal(readCache().links.length, 1, 'AI 生成只读，不能写库');
  } finally {
    await server.stop();
  }
});
