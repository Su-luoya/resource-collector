#!/usr/bin/env node
// 把每个域名的 favicon 抓下来传到 Supabase Storage（桶 icons），并把「域名 → 对象」写进云端 icons 表。
// 好处：页面不依赖第三方图标服务（国内访问稳定），也不怕源站删图标；仓库里不存图片文件。
// 用法：node scripts/fetch-icons.mjs [--force] [--push]
//
// 键是「规范化域名」（去掉 www.、小写，见 src/lib/link-data.mjs 的 hostKey），
// 与页面查图标用的是同一把键——所以 www.nber.org 与 nber.org 共用一份图标。
// 取不到的域名记下时间，30 天内不再重试：发布里最贵的时间都花在这上面。
//
// 字节存 Storage，`npm run sync`（构建前）再把缺的从 Storage 下到 public/icons/。
// 所以这里写成两件事：抓（含上传）与 --push（只把本地已有文件推到 Storage，不联网抓站）。
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hostKey } from '../src/lib/link-data.mjs';
import { describeMiss, isRetryable, MISS_DAYS } from '../src/lib/icon-cache.mjs';
import { clientFor, refreshCache, storageFor } from '../src/lib/cloud-sync.mjs';
import { objectName } from '../src/lib/storage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const push = process.argv.includes('--push');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

// 域名集合以云端为准，不读本地缓存：下面清旧映射是按它做减法的，缓存落后（刚收了链接还没 sync）
// 就会把新域名的图标当成「已删除」一起清掉。
const client = clientFor({ write: true });
const storage = storageFor({ write: true });
const rows = await client.listLinks();

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
/** 与 EXT 反着走：--push 只有本地文件，类型得从扩展名推 */
const MIME = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]));

const slug = (host) => host.replace(/[^a-z0-9.-]/gi, '_');
const localPath = (file) => resolve(root, 'public', file);
const mimeOf = (name) => MIME[name.split('.').pop()?.toLowerCase()] ?? 'application/octet-stream';

// 现有映射与失败记录都从库里读：换台机器、换次 CI 都接着上次的进度走
const iconRows = await client.listIcons();
const map = {};
const misses = {};
for (const row of iconRows) {
  if (row.file) map[row.host] = row.file;
  else if (row.missed_at) misses[row.host] = row.missed_at;
}

// --push：把本地已有图标一次性推到 Storage（首次迁移、换桶后用），不联网抓站
if (push) {
  let ok = 0;
  const missing = [];
  for (const [key, file] of Object.entries(map)) {
    const source = localPath(file);
    if (!existsSync(source)) {
      missing.push(key);
      continue;
    }
    const name = objectName(file);
    await storage.upload(name, readFileSync(source), mimeOf(name));
    ok++;
  }
  console.log(`✓ 已上传 ${ok} 个本地图标 → Storage`);
  if (missing.length) console.log(`注意：${missing.length} 个域名表里有映射但本地没文件：${missing.join(', ')}`);
  process.exit(0);
}

async function get(url, timeout = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** 下载并校验，文件名只由规范化域名决定；类型/体积不合适就放弃。返回待上传的字节 */
async function save(key, url) {
  const res = await get(url);
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 70 || bytes.length > 300_000) return null; // 太小是占位图/空文件，太大不是图标
  const name = `${slug(key)}.${ext}`;
  return { file: `icons/${name}`, name, bytes, type };
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

// 待抓 = 表里没有、或本地缓存缺文件（缺文件时先试着从 Storage 补，补不到才去抓源站）
// 冷却期内的不算待抓：这里一次性报出来，进度里的「N 个待抓」才和实际会动的行数对得上
const todo = [...hosts.keys()].filter((key) => force || !map[key] || !existsSync(localPath(map[key])));
const toFetch = [];
for (const key of todo) {
  if (!force && misses[key] && !isRetryable(misses[key])) {
    console.log(`· 跳过 ${key}（${describeMiss(misses[key])}，${MISS_DAYS} 天内不重试）`);
    continue;
  }
  toFetch.push(key);
}
// 这行给发布进度用：前端能算出「3/24」而不用猜
console.log(`计划：共 ${hosts.size} 个域名，${toFetch.length} 个待抓`);

async function worker() {
  while (toFetch.length) {
    const key = toFetch.shift();
    const existing = map[key];

    // 表里已有映射，只是本地缓存没了：从 Storage 补回，不必再打扰源站
    if (existing && !force) {
      const bytes = await storage.download(existing).catch(() => null);
      if (bytes) {
        writeFileSync(localPath(existing), bytes);
        console.log(`✓ ${key} 从 Storage 补回本地`);
        continue;
      }
    }

    const found = await discover(hosts.get(key), key);
    const now = new Date().toISOString();
    if (found) {
      // 先上传再写表：表里的映射必须对得上 Storage 里真实存在的对象
      try {
        await storage.upload(found.name, found.bytes, found.type);
      } catch (error) {
        console.log(`✗ ${key} 抓到但上传失败，下次重试：${error.message}`);
        continue; // 不写表、不记冷却，下回再来
      }
      writeFileSync(localPath(found.file), found.bytes);
      map[key] = found.file;
      delete misses[key];
      console.log(`✓ ${key} → ${found.file}`);
      await client.upsertIcons([{ host: key, file: found.file, missed_at: null }]);
    } else {
      delete map[key];
      misses[key] = now;
      console.log(`✗ ${key} 取不到图标，用首字母占位`);
      await client.upsertIcons([{ host: key, file: null, missed_at: now }]);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

// 数据里已经删掉的域名不再留在表里：表行与 Storage 对象一起清，不然库越用越脏
// （表里的孤儿行不会自己消失，Storage 对象也是；以后排查「引用了不存在的对象」时都是噪音）
const stale = iconRows.filter((row) => !hosts.has(row.host));
for (const key of Object.keys(map)) if (!hosts.has(key)) delete map[key];
if (stale.length) {
  const objects = stale.map((row) => objectName(row.file)).filter(Boolean);
  try {
    if (objects.length) await storage.remove(objects);
    await client.deleteIcons(stale.map((row) => row.host));
    console.log(`\n已删掉 ${stale.length} 个已不在数据里的域名映射${objects.length ? `（含 ${objects.length} 个 Storage 对象）` : ''}：${stale.map((row) => row.host).join(', ')}`);
  } catch (error) {
    // 清理失败不该让整次发布失败：图标照旧，下次再清
    console.warn(`! 清理旧图标映射失败：${error.message}`);
  }
}

await refreshCache(client);

// public/icons 是完全派生的缓存：清掉没人引用的文件，免得它们混进 dist
const referenced = new Set(Object.values(map).map((path) => objectName(path)));
const orphans = readdirSync(outDir).filter((name) => !referenced.has(name) && name !== '.gitkeep');
for (const name of orphans) unlinkSync(resolve(outDir, name));
if (orphans.length) console.log(`\n已清理 ${orphans.length} 个没人引用的本地图标：${orphans.join(', ')}`);
console.log(`\n完成：${Object.keys(map).length}/${hosts.size} 个域名有图标 → icons 表 + Storage`);
