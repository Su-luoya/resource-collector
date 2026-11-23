#!/usr/bin/env node
// 把每个域名的 favicon 下载到 public/icons/，生成 src/data/icons.json。
// 好处：页面不依赖第三方图标服务（国内访问稳定），也不怕源站删图标。
// 用法：node scripts/fetch-icons.mjs [--force]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const rows = parse(readFileSync(resolve(root, 'src/data/links.yaml'), 'utf8'));
const outDir = resolve(root, 'public/icons');
const mapFile = resolve(root, 'src/data/icons.json');
mkdirSync(outDir, { recursive: true });

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const hosts = [...new Set(rows.map((r) => new URL(r.url).hostname))].sort();
const map = existsSync(mapFile) ? JSON.parse(readFileSync(mapFile, 'utf8')) : {};

const EXT = { 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const slug = (host) => host.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');

async function get(url, timeout = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function save(host, url) {
  const res = await get(url);
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 70 || buf.length > 300_000) return null; // 太小是占位图/空文件，太大不是图标
  const name = `${slug(host)}.${ext}`;
  writeFileSync(resolve(outDir, name), buf);
  return `icons/${name}`;
}

async function discover(host) {
  // 1) 直接猜 /favicon.ico
  const direct = await save(host, `https://${host}/favicon.ico`).catch(() => null);
  if (direct) return direct;

  // 2) 抓首页 <link rel="icon">
  try {
    const res = await get(`https://${host}/`, 12_000);
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi) || [];
    for (const tag of m) {
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const abs = new URL(href, `https://${host}/`).href;
      const saved = await save(host, abs).catch(() => null);
      if (saved) return saved;
    }
  } catch {
    /* ignore */
  }
  return null;
}

const queue = [...hosts];
async function worker() {
  while (queue.length) {
    const host = queue.shift();
    const existing = map[host];
    if (!force && existing && existsSync(resolve(root, 'public', existing))) {
      console.log(`· 已有 ${host}`);
      continue;
    }
    const saved = await discover(host);
    if (saved) {
      map[host] = saved;
      console.log(`✓ ${host} → ${saved}`);
    } else {
      delete map[host];
      console.log(`✗ ${host} 取不到图标，用首字母占位`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

writeFileSync(mapFile, `${JSON.stringify(Object.fromEntries(Object.entries(map).sort()), null, 2)}\n`);
console.log(`\n完成：${Object.keys(map).length}/${hosts.length} 个域名有本地图标 → src/data/icons.json`);
