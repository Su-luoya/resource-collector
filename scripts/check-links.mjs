#!/usr/bin/env node
// 探测所有链接；安全的同主机永久重定向直接修 links.yaml，其余写入体检报告。
// GitHub Actions 每周运行；有自动修复时，工作流会先跑完整验证再提交两个数据文件。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { dumpLinks, parseLinks, validateRows } from '../src/lib/link-data.mjs';
import { applyRedirectFixes, probeLink } from '../src/lib/link-maintenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const linksFile = resolve(root, 'src/data/links.yaml');
const outFile = resolve(root, 'src/data/link-status.json');
const raw = readFileSync(linksFile, 'utf8');
const links = parseLinks(raw);
const taxonomy = JSON.parse(readFileSync(resolve(root, 'src/data/taxonomy.json'), 'utf8'));
const CONCURRENCY = 6;
const today = new Date().toISOString().slice(0, 10);
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
if (errors.length) throw new Error(`自动修复后的 links.yaml 未通过校验：\n${errors.join('\n')}`);
if (fixed.fixes.length) writeFileSync(linksFile, dumpLinks(fixed.rows, raw));

const sorted = Object.fromEntries(Object.entries(fixed.statuses).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(outFile, `${JSON.stringify(sorted, null, 2)}\n`);

for (const fix of fixed.fixes) console.log(`FIX ${fix.title}: ${fix.from} → ${fix.to}`);
const count = (level) => Object.values(results).filter((value) => value.status === level).length;
console.log(
  `\n✓ 完成：ok ${count('ok')} · redirect ${count('redirect')} · warn ${count('warn')} · fail ${count('fail')} · 自动修复 ${fixed.fixes.length}` +
    ' → src/data/link-status.json',
);
