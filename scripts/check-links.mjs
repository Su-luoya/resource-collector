#!/usr/bin/env node
// 探测所有链接；安全的同主机永久重定向直接改库，其余写入 link_status 表。
// GitHub Actions 每周运行；本地也可以手动跑一次。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateRows } from '../src/lib/link-data.mjs';
import { applyRedirectFixes, probeLink } from '../src/lib/link-maintenance.mjs';
import { clientFor, readCache, refreshCache } from '../src/lib/cloud-sync.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = readCache();
const links = cache.links;
const taxonomy = JSON.parse(readFileSync(resolve(root, 'src/data/taxonomy.json'), 'utf8'));
const CONCURRENCY = 6;
const today = new Date().toISOString().slice(0, 10);

const client = clientFor({ write: true });

const results = {};
const queue = [...links];

async function worker() {
  while (queue.length) {
    const link = queue.shift();
    const result = await probeLink(link.url);
    results[link.url] = result;
    const mark = result.status === 'ok' ? '✓' : result.status === 'redirect' ? '→' : result.status === 'warn' ? '±' : '✗';
    console.log(`${mark} ${result.code || result.error} ${link.url}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const fixed = applyRedirectFixes(links, results, today);
const { errors } = validateRows(fixed.rows, taxonomy, today);
if (errors.length) throw new Error(`自动修复后的数据未通过校验：\n${errors.join('\n')}`);

if (fixed.fixes.length) await client.replaceLinks(fixed.rows);
for (const [url, info] of Object.entries(fixed.statuses)) await client.upsertStatus({ ...info, url });
await refreshCache(client);

for (const fix of fixed.fixes) console.log(`FIX ${fix.title}: ${fix.from} → ${fix.to}`);
const count = (level) => Object.values(results).filter((value) => value.status === level).length;
console.log(
  `\n✓ 完成：ok ${count('ok')} · redirect ${count('redirect')} · warn ${count('warn')} · fail ${count('fail')} · 自动修复 ${fixed.fixes.length}` +
    ' → link_status 表',
);
