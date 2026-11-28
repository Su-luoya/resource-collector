// src/lib/icon-cache.mjs 与 scripts/fetch-icons.mjs 的失败缓存：这几条规则决定
// 「发布还等不等那 20 多秒」，所以要钉住边界，尤其是 30 天这条线。
// 用法：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeMiss, isRetryable, MISS_DAYS } from '../src/lib/icon-cache.mjs';
import { startFakeCloud } from './helpers/cloud.mjs';

const DAY = 86_400_000;
const now = Date.parse('2026-03-01T00:00:00.000Z');

test('失败记录未满 30 天就不再重试，满 30 天与坏日期都要重试一次', () => {
  assert.equal(isRetryable(new Date(now - 29 * DAY).toISOString(), now), false);
  assert.equal(isRetryable(new Date(now - MISS_DAYS * DAY).toISOString(), now), true);
  assert.equal(isRetryable('2026-13-99', now), true);
  assert.equal(isRetryable(undefined, now), true);
});

test('日志文案：今天 / N 天前 / 读不懂的日期', () => {
  assert.equal(describeMiss(new Date(now - 3600_000).toISOString(), now), '今天取不到');
  assert.equal(describeMiss(new Date(now - 3 * DAY).toISOString(), now), '3 天前取不到');
  assert.equal(describeMiss('', now), '取不到');
});

test('图标抓取保留冷却记录和已有文件，清理只删不再使用的对象', async (t) => {
  const root = process.cwd();
  const scratch = join(root, '.scratch');
  mkdirSync(scratch, { recursive: true });
  const tmp = mkdtempSync(join(scratch, 'icons-test-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

  for (const dir of ['scripts', 'src/lib', 'src/data', 'public/icons', '.cache']) mkdirSync(join(tmp, dir), { recursive: true });
  cpSync(join(root, 'scripts/fetch-icons.mjs'), join(tmp, 'scripts/fetch-icons.mjs'));
  for (const file of ['link-data.mjs', 'icon-cache.mjs', 'cloud.mjs', 'cloud-sync.mjs', 'storage.mjs', 'http-body.mjs']) {
    cpSync(join(root, 'src/lib', file), join(tmp, 'src/lib', file));
  }
  // 失败记录现在存在图标表里（file 为空 + missed_at），不再是本地文件
  const cloud = await startFakeCloud({
    links: [{ title: 'A', url: 'https://miss.example.com/', section: ['tools'], facets: { tools: { kind: 'tool' } }, desc: 'A', added: '2026-01-01' }],
    icons: [{ host: 'miss.example.com', file: null, missed_at: new Date().toISOString() }],
  });
  cloud.use();
  t.after(() => cloud.close());
  writeFileSync(join(tmp, 'offline.mjs'),
    `const original = globalThis.fetch;
     globalThis.fetch = (url, init) => new URL(url).origin === process.env.SUPABASE_URL
       ? original(url, init) : Promise.resolve(new Response(null, { status: 503 }));`);
  const run = (...args) => promisify(execFile)(process.execPath,
    ['--import', './offline.mjs', 'scripts/fetch-icons.mjs', ...args], { cwd: tmp });
  const { stdout: out } = await run();
  assert.match(out, /miss\.example\.com（今天取不到，30 天内不重试）/);
  assert.match(out, /0 个待抓/);
  assert.deepEqual(cloud.iconRows().map((row) => row.file), [null]);

  await t.test('强刷遇到源站故障不丢旧图标；删掉共享文件的旧域名不删文件', async () => {
    const file = 'icons/shared.ico';
    for (const host of ['miss.example.com', 'retired.example.com']) cloud.tables.icons.set(host, { host, file });
    const local = join(tmp, 'public', file);
    writeFileSync(local, 'cached');
    await run('--force');
    assert.deepEqual(cloud.iconRows(), [{ host: 'miss.example.com', file }]);
    assert.equal(readFileSync(local, 'utf8'), 'cached');
    assert.ok(!cloud.requests.some((r) => r.method === 'DELETE' && r.body?.prefixes?.includes('shared.ico')));
  });
});
