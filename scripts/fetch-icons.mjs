#!/usr/bin/env node
// 把每个域名的 favicon 下载到 public/icons/，生成 src/data/icons.json。
// 好处：页面不依赖第三方图标服务（国内访问稳定），也不怕源站删图标。
// 用法：node scripts/fetch-icons.mjs [--force]
//
// 图标表的键是「规范化域名」（去掉 www.、小写，见 src/lib/link-data.mjs 的 hostKey），
// 与页面查图标用的是同一把键——所以 www.nber.org 与 nber.org 共用一份图标。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hostKey, parseLinks } from '../src/lib/link-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const rows = parseLinks(readFileSync(resolve(root, 'src/data/links.yaml'), 'utf8'));
const outDir = resolve(root, 'public/icons');
const mapFile = resolve(root, 'src/data/icons.json');
mkdirSync(outDir, { recursive: true });

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** key（规范化域名）→ 数据里实际写的 hostname，抓取时先试它 */
const hosts = new Map();
for (const row of rows) {
  let hostname;
  try {
    hostname = new URL(row.url).hostname;
  } catch {
    continue;
  }
  const key = hostKey(hostname);
  if (key && !hosts.has(key)) hosts.set(key, hostname);
}

/** 依次尝试：数据里写的主机 → 去掉 www → 加上 www。有些站点只在其中一种写法上给图标 */
const candidates = (hostname, key) => [...new Set([hostname, key, `www.${key}`])].filter(Boolean);

const EXT = {
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const slug = (host) => host.replace(/[^a-z0-9.-]/gi, '_');

/** 老版本的键带着 www.，读进来先迁移到规范化键：文件没动过，不用重抓 */
const loadMap = () => {
  if (!existsSync(mapFile)) return {};
  const old = JSON.parse(readFileSync(mapFile, 'utf8'));
  const map = {};
  for (const [rawKey, path] of Object.entries(old)) {
    const key = hostKey(rawKey);
    if (key && !map[key]) map[key] = path;
  }
  return map;
};

const map = loadMap();

async function get(url, timeout = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** 下载并落盘，文件名只由规范化域名决定；类型/体积不合适就放弃 */
async function save(key, url) {
  const res = await get(url);
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 70 || buf.length > 300_000) return null; // 太小是占位图/空文件，太大不是图标
  const name = `${slug(key)}.${ext}`;
  writeFileSync(resolve(outDir, name), buf);
  return `icons/${name}`;
}

async function discover(hostname, key) {
  const list = candidates(hostname, key);

  // 1) 直接猜 /favicon.ico
  for (const host of list) {
    const direct = await save(key, `https://${host}/favicon.ico`).catch(() => null);
    if (direct) return direct;
  }

  // 2) 抓首页 <link rel="icon">
  for (const host of list) {
    try {
      const res = await get(`https://${host}/`, 12_000);
      if (!res.ok) continue;
      const html = await res.text();
      const tags = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi) || [];
      for (const tag of tags) {
        const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
        if (!href) continue;
        const abs = new URL(href, `https://${host}/`).href;
        const saved = await save(key, abs).catch(() => null);
        if (saved) return saved;
      }
    } catch {
      /* 换下一个候选 */
    }
  }
  return null;
}

const queue = [...hosts.keys()];
async function worker() {
  while (queue.length) {
    const key = queue.shift();
    const existing = map[key];
    if (!force && existing && existsSync(resolve(root, 'public', existing))) {
      console.log(`· 已有 ${key}`);
      continue;
    }
    const saved = await discover(hosts.get(key), key);
    if (saved) {
      map[key] = saved;
      console.log(`✓ ${key} → ${saved}`);
    } else {
      delete map[key];
      console.log(`✗ ${key} 取不到图标，用首字母占位`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

// 数据里已经删掉的域名不再留在表里
for (const key of Object.keys(map)) if (!hosts.has(key)) delete map[key];

writeFileSync(mapFile, `${JSON.stringify(Object.fromEntries(Object.entries(map).sort()), null, 2)}\n`);

const referenced = new Set(Object.values(map).map((path) => path.replace(/^icons\//, '')));
const orphans = readdirSync(outDir).filter((name) => !referenced.has(name));
if (orphans.length) console.log(`\n注意：public/icons 里有 ${orphans.length} 个没人引用的文件：${orphans.join(', ')}`);
console.log(`\n完成：${Object.keys(map).length}/${hosts.size} 个域名有本地图标 → src/data/icons.json`);
