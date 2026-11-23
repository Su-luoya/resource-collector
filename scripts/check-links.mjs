#!/usr/bin/env node
// 探测 links.yaml 里所有链接的可用性，结果写入 src/data/link-status.json。
// 本地可用：node scripts/check-links.mjs（GitHub Actions 每周自动跑一次并提交结果）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const links = parse(readFileSync(resolve(root, 'src/data/links.yaml'), 'utf8')).links;
const outFile = resolve(root, 'src/data/link-status.json');

const TIMEOUT = 12_000;
const CONCURRENCY = 6;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function classify(status, error) {
  if (error) return /ENOTFOUND|EAI_AGAIN|CERT|SSL/i.test(String(error)) ? 'fail' : 'warn';
  if (status >= 200 && status < 400) return 'ok';
  if ([401, 403, 405, 429].includes(status)) return 'warn'; // 需要登录 / 反爬 / 限流
  return 'fail';
}

async function probe(url) {
  const headers = { 'User-Agent': UA, Accept: 'text/html,*/*' };
  if (/^https:\/\/api\.github\.com\//.test(url) && process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { method, headers, redirect: 'follow', signal: ctrl.signal });
      // 部分站点 HEAD 返回 405，改用 GET 再试一次
      if (method === 'HEAD' && [400, 403, 405, 501].includes(res.status)) return attempt('GET');
      return { status: res.status, finalUrl: res.url };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const r = await attempt('HEAD');
    return { status: r.status, level: classify(r.status), finalUrl: r.finalUrl };
  } catch (e) {
    const code = e?.cause?.code || e?.name || String(e);
    return { status: 0, level: classify(0, code), error: code };
  }
}

const today = new Date().toISOString().slice(0, 10);
const result = {};
const queue = [...links];

async function worker() {
  while (queue.length) {
    const l = queue.shift();
    const r = await probe(l.url);
    result[l.url] = { status: r.level, ...(r.error ? { error: r.error } : { code: r.status }), checked: today };
    const mark = r.level === 'ok' ? '✓' : r.level === 'warn' ? '±' : '✗';
    console.log(`${mark} ${r.status || r.error} ${l.url}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(outFile, `${JSON.stringify(sorted, null, 2)}\n`);

const count = (lvl) => Object.values(result).filter((v) => v.status === lvl).length;
console.log(`\n✓ 完成：ok ${count('ok')} · warn ${count('warn')} · fail ${count('fail')} → src/data/link-status.json`);
