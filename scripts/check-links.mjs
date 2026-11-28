#!/usr/bin/env node
// 探测所有链接；安全的同主机永久重定向直接改库，其余写入 link_status 表。
// GitHub Actions 每周运行；本地也可以手动跑一次。
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateRows } from '../src/lib/link-data.mjs';
import { applyRedirectFixes, confirmFailure, probeLink } from '../src/lib/link-maintenance.mjs';
import { clientFor, readCache, refreshCache } from '../src/lib/cloud-sync.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = readCache();
const links = cache.links;
const previous = cache.status ?? {};
const taxonomy = JSON.parse(readFileSync(resolve(root, 'src/data/taxonomy.json'), 'utf8'));
const CONCURRENCY = 6;
const today = new Date().toISOString().slice(0, 10);

const client = clientFor({ write: true });

const results = {};
const queue = [...links];

async function worker() {
  while (queue.length) {
    const link = queue.shift();
    // 单次失败先降为 warn，下一轮仍是失败才判 fail：一次 502 不该让卡片变红
    const result = confirmFailure(await probeLink(link.url), previous[link.url]);
    results[link.url] = result;
    const mark = result.status === 'ok' ? '✓' : result.status === 'redirect' ? '→' : result.status === 'warn' ? '±' : '✗';
    console.log(`${mark} ${result.code || result.error} ${link.url}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const fixed = applyRedirectFixes(links, results, today);
const { errors } = validateRows(fixed.rows, taxonomy, today);
if (errors.length) throw new Error(`自动修复后的数据未通过校验：\n${errors.join('\n')}`);

let writeFailed = 0;
let fixedCount = 0;
// 只改 URL 列：这几分钟里别人改过的标题、笔记不能被快照冲掉。
for (const fix of fixed.fixes) {
  try {
    await client.updateLink(fix.from, { url: fix.to });
    fixedCount++;
    console.log(`FIX ${fix.title}: ${fix.from} → ${fix.to}`);
  } catch (error) {
    // 目标可能已归别人；不能把旧地址的检查结果写到它上面。
    delete fixed.statuses[fix.to];
    writeFailed++;
    console.warn(`! 自动修复没写进去 ${fix.from} → ${fix.to}：${error.message}`);
  }
}
// 状态是派生数据：一次请求写完（一百多条一条一个往返要半分钟）
try {
  await client.upsertStatuses(Object.entries(fixed.statuses).map(([url, info]) => ({ ...info, url })));
} catch (error) {
  writeFailed++;
  console.warn(`! 状态写入失败：${error.message}`);
}
const current = await refreshCache(client);

/** 状态（种类 / 状态码 / 最终地址 / 错误）有变化才值得重建；checked 日期本身不算 */
const statusChanged = (before, after) => {
  const urls = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const url of urls) {
    const a = before[url];
    const b = after[url];
    if (!a || !b) return true;
    if (a.status !== b.status || a.code !== b.code || a.error !== b.error || a.final !== b.final) return true;
  }
  return false;
};

const rebuild = fixedCount > 0 || statusChanged(previous, current.status);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `rebuild=${rebuild}\n`);

const count = (level) => Object.values(results).filter((value) => value.status === level).length;
console.log(
  `\n✓ 完成：ok ${count('ok')} · redirect ${count('redirect')} · warn ${count('warn')} · fail ${count('fail')} · 自动修复 ${fixedCount}` +
    ` → link_status 表；${rebuild ? '状态有变化，需要重建' : '状态没变化，跳过重建'}` +
    (writeFailed ? `；${writeFailed} 条写入失败` : ''),
);
if (writeFailed) process.exitCode = 1;
