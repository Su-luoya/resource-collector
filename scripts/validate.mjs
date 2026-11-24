#!/usr/bin/env node
// 数据校验：跑 `npm run check`（会先 npm run sync 把云端数据拉进 .cache/links.json）。
// 规则本体在 src/lib/link-data.mjs，与 dev 编辑端点共用同一份，避免两套规则漂移。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateRows } from '../src/lib/link-data.mjs';
import { readCache } from '../src/lib/cloud-sync.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const taxonomy = JSON.parse(readFileSync(resolve(root, 'src/data/taxonomy.json'), 'utf8'));

let cache;
try {
  cache = readCache();
} catch {
  console.error('✗ 没有 .cache/links.json：先跑 npm run sync 从云端拉一次数据');
  process.exit(1);
}

const rows = cache.links ?? [];
const { errors, warns } = validateRows(rows, taxonomy);

for (const w of warns) console.warn(`warn  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error ${e}`);
  console.error(`\n✗ ${errors.length} 个问题`);
  process.exit(1);
}
console.log(`✓ ${rows.length} 条链接校验通过（同步于 ${cache.syncedAt ?? '未知时间'}）`);
