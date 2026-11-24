// src/lib/icon-cache.mjs 与 scripts/fetch-icons.mjs 的失败缓存：这几条规则决定
// 「发布还等不等那 20 多秒」，所以要钉住边界，尤其是 30 天这条线。
// 用法：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeMiss, isRetryable, MISS_DAYS, pruneMisses } from '../src/lib/icon-cache.mjs';

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

  for (const dir of ['scripts', 'src/lib', 'src/data', 'public/icons']) mkdirSync(join(tmp, dir), { recursive: true });
  cpSync(join(root, 'scripts/fetch-icons.mjs'), join(tmp, 'scripts/fetch-icons.mjs'));
  for (const file of ['link-data.mjs', 'icon-cache.mjs']) {
    cpSync(join(root, 'src/lib', file), join(tmp, 'src/lib', file));
  }
  writeFileSync(
    join(tmp, 'src/data/links.yaml'),
    '- {title: A, url: https://miss.example.com/, section: [nav], facets: {nav: {kind: tool}}, desc: A, added: 2026-01-01}\n',
  );
  writeFileSync(join(tmp, 'src/data/icons.json'), '{}\n');
  mkdirSync(join(tmp, '.cache'));
  writeFileSync(
    join(tmp, '.cache/icon-misses.json'),
    JSON.stringify({ 'miss.example.com': new Date().toISOString() }),
  );

  const out = execFileSync(process.execPath, ['scripts/fetch-icons.mjs'], { cwd: tmp, encoding: 'utf8' });
  assert.match(out, /miss\.example\.com（今天取不到，30 天内不重试）/);
  assert.match(out, /0 个待抓/);
  assert.deepEqual(JSON.parse(readFileSync(join(tmp, 'src/data/icons.json'), 'utf8')), {});
});
