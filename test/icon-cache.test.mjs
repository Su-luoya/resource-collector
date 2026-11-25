// src/lib/icon-cache.mjs 与 scripts/fetch-icons.mjs 的失败缓存：这几条规则决定
// 「发布还等不等那 20 多秒」，所以要钉住边界，尤其是 30 天这条线。
// 用法：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describeMiss, isRetryable, MISS_DAYS, pruneMisses } from '../src/lib/icon-cache.mjs';
import { startFakeCloud } from './helpers/cloud.mjs';
import { writeCache } from '../src/lib/cloud-sync.mjs';

const DAY = 86_400_000;
const now = Date.parse('2026-03-01T00:00:00.000Z');

test('失败记录未满 30 天就不再重试，满 30 天与坏日期都要重试一次', () => {
  assert.equal(isRetryable(new Date(now - 29 * DAY).toISOString(), now), false);
  assert.equal(isRetryable(new Date(now - MISS_DAYS * DAY).toISOString(), now), true);
  assert.equal(isRetryable('2026-13-99', now), true);
  assert.equal(isRetryable(undefined, now), true);
});

test('清理缓存：数据里没了的域名、已过期的记录都丢掉', () => {
  const misses = {
    'keep.io': new Date(now - DAY).toISOString(),
    'gone.io': new Date(now - DAY).toISOString(),
    'stale.io': new Date(now - 40 * DAY).toISOString(),
  };
  assert.deepEqual(Object.keys(pruneMisses(misses, new Set(['keep.io', 'stale.io']), now)), ['keep.io']);
  assert.deepEqual(pruneMisses(undefined, new Set(), now), {});
});

test('日志文案：今天 / N 天前 / 读不懂的日期', () => {
  assert.equal(describeMiss(new Date(now - 3600_000).toISOString(), now), '今天取不到');
  assert.equal(describeMiss(new Date(now - 3 * DAY).toISOString(), now), '3 天前取不到');
  assert.equal(describeMiss('', now), '取不到');
});

test('已知取不到的域名：脚本跳过且不联网，图标表保持不变', async (t) => {
  const root = process.cwd();
  const scratch = join(root, '.scratch');
  mkdirSync(scratch, { recursive: true });
  const tmp = mkdtempSync(join(scratch, 'icons-test-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));

  for (const dir of ['scripts', 'src/lib', 'src/data', 'public/icons', '.cache']) mkdirSync(join(tmp, dir), { recursive: true });
  cpSync(join(root, 'scripts/fetch-icons.mjs'), join(tmp, 'scripts/fetch-icons.mjs'));
  for (const file of ['link-data.mjs', 'icon-cache.mjs', 'cloud.mjs', 'cloud-sync.mjs']) {
    cpSync(join(root, 'src/lib', file), join(tmp, 'src/lib', file));
  }
  // 失败记录现在存在图标表里（file 为空 + missed_at），不再是本地文件
  const cloud = await startFakeCloud({
    links: [{ title: 'A', url: 'https://miss.example.com/', section: ['tools'], facets: { tools: { kind: 'tool' } }, desc: 'A', added: '2026-01-01' }],
    icons: [{ host: 'miss.example.com', file: null, missed_at: new Date().toISOString() }],
  });
  cloud.use();
  writeCache({
    links: [{ title: 'A', url: 'https://miss.example.com/', section: ['tools'], facets: { tools: { kind: 'tool' } }, desc: 'A', added: '2026-01-01' }],
    status: [],
    icons: {},
    syncedAt: new Date().toISOString(),
  }, join(tmp, '.cache/links.json'));

  // 假云跟测试同一个进程：必须用 spawn（异步）而不是 execFileSync，否则事件循环被堵住、请求永远等不到响应
  const out = await new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/fetch-icons.mjs'], { cwd: tmp, env: process.env });
    let text = '';
    child.stdout.on('data', (chunk) => (text += chunk));
    child.on('close', () => done(text));
  });
  await cloud.close();
  assert.match(out, /miss\.example\.com（今天取不到，30 天内不重试）/);
  assert.match(out, /0 个待抓/);
  assert.deepEqual(cloud.iconRows().map((row) => row.file), [null]);
});
