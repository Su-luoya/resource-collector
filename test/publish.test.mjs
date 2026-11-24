import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dev } from 'astro';
import { runTask } from './helpers/task.mjs';

test('推送失败后：工作区干净仍待推送；重试不抓图标、不新建提交', async (t) => {
  const root = process.cwd();
  const scratch = join(root, '.scratch');
  mkdirSync(scratch, { recursive: true });
  const tmp = mkdtempSync(join(scratch, 'publish-test-'));
  const repo = join(tmp, 'work');
  const origin = join(tmp, 'origin.git');
  mkdirSync(repo);
  process.chdir(repo);
  t.after(() => { process.chdir(root); rmSync(tmp, { recursive: true, force: true }); });
  // 这个测试文件在独立进程内运行，不继承调用者的仓库、暂存区或远端配置。
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file',
    ASTRO_TELEMETRY_DISABLED: '1', ASTRO_DISABLE_UPDATE_CHECK: 'true', TMPDIR: tmp,
  });
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('init', '--bare', origin);
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('remote', 'add', 'origin', origin);
  for (const dir of ['src/pages', 'src/lib', 'src/data', 'public/icons', 'scripts']) mkdirSync(dir, { recursive: true });
  for (const file of ['src/middleware.ts', 'src/lib/dev-meta.mjs', 'src/lib/link-data.mjs', 'src/lib/link-maintenance.mjs', 'src/lib/link-quality.mjs', 'src/lib/ai-draft.mjs', 'src/lib/dev-task.mjs', 'src/lib/icon-cache.mjs', 'src/lib/link-rules.mjs', 'src/lib/bookmarks-html.mjs', 'src/data/taxonomy.json']) cpSync(join(root, file), file);
  writeFileSync('src/pages/index.astro', 'fixture');
  writeFileSync('src/data/links.yaml', '[]\n');
  writeFileSync('src/data/link-status.json', '{}\n');
  writeFileSync('src/data/icons.json', '{}\n');
  writeFileSync('public/icons/.gitkeep', '');
  writeFileSync('scripts/fetch-icons.mjs', "import { appendFileSync } from 'node:fs'; appendFileSync('icon-runs', 'x');");
  git('add', 'src', 'public', 'scripts');
  git('commit', '-m', 'seed');
  git('push', 'origin', 'main');
  const server = await dev({ root: repo, configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  try {
    const api = async (name) => (await fetch(`http://127.0.0.1:${server.address.port}/api/${name}`, { method: name === 'status' ? 'GET' : 'POST' })).json();
    writeFileSync('src/data/links.yaml', '- {title: Test, url: https://example.org/, section: [nav], facets: {nav: {kind: tool}}, desc: Test, added: 2026-01-01}\n');
    writeFileSync('unrelated.txt', '留在暂存区');
    git('add', 'unrelated.txt');
    git('config', 'remote.origin.pushurl', join(tmp, 'offline.git'));
    // 任务端点：快照必须带完整步骤表，前端就是靠它画进度条
    const seen = [];
    const failed = await runTask(server.address.port, 'publish', {}, { onSnapshot: (task) => seen.push(task) });
    assert.ok(seen.length >= 1, '至少要拿到一次任务快照');
    assert.deepEqual(seen[0].steps.map((step) => step.id), ['check', 'icons', 'commit', 'push']);
    assert.ok(seen[0].steps.every((step) => typeof step.label === 'string' && step.label.length > 0));
    assert.ok(seen.every((task) => ['running', 'ok', 'fail'].includes(task.status)));
    assert.equal(failed.pushed, false, failed.message);
    const head = git('rev-parse', 'HEAD');
    const pending = await api('status');
    assert.equal(pending.dirty, false);
    assert.equal(pending.ahead, 1);
    git('config', '--unset', 'remote.origin.pushurl');
    const pushed = await runTask(server.address.port, 'publish');
    assert.equal(pushed.ok, true, pushed.message);
    assert.equal(git('--git-dir', origin, 'rev-parse', 'main'), head);
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal((await api('status')).ahead, 0);
    assert.equal((await runTask(server.address.port, 'publish')).nothing, true);
    assert.equal(readFileSync('icon-runs', 'utf8'), 'x');
    assert.equal(git('diff', '--cached', '--name-only'), 'unrelated.txt');

    // 没有同名远端记录不算已同步；已知落后时不能覆盖远端。
    git('switch', '-c', 'draft', 'HEAD~1');
    assert.equal((await api('status')).ahead, null);
    git('push', 'origin', 'main:refs/heads/draft');
    assert.equal((await api('status')).behind, 1);
    assert.equal((await runTask(server.address.port, 'publish')).ok, false);
    assert.equal(git('--git-dir', origin, 'rev-parse', 'draft'), head);
  } finally {
    await server.stop();
  }
});
