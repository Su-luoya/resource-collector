/**
 * 云端与本地的桥：读 .env、建客户端、把库里的数据拉成一份构建用的缓存。
 *
 * 缓存 `.cache/links.json`（git-ignored）是构建期唯一的输入：页面、校验、图标脚本都读它。
 * 写入路径不走缓存，一律直接对库操作，写完再刷新缓存，免得两处状态打架。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './cloud.mjs';
import { createStorage } from './storage.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 缓存与 .env 都按当前工作目录算：dev server、脚本、测试各自在自己的仓库根下跑 */
export const cachePath = () => resolve(process.cwd(), '.cache/links.json');

/** 读 .env：只认 KEY=VALUE，忽略注释与空行；已存在的 process.env 优先，方便 CI 直接注入 */
export const readEnv = (file = resolve(process.cwd(), '.env')) => {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = value;
  }
  return process.env;
};

/** 写权限要 secret key；只读构建用 anon（publishable）key 即可 */
export const clientFor = ({ write = false } = {}) => {
  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = write ? env.SUPABASE_SECRET_KEY : env.SUPABASE_ANON_KEY || env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      write ? '缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY（写在 .env 里，CI 里用 secrets 注入）' : '缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY',
    );
  }
  return createClient({ url, key });
};

/** 图标字节的 Storage 客户端：同样的 key 规则，写要 secret，读用 anon（public read 桶） */
export const storageFor = ({ write = false } = {}) => {
  const env = readEnv();
  const url = env.SUPABASE_URL;
  const key = write ? env.SUPABASE_SECRET_KEY : env.SUPABASE_ANON_KEY || env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      write ? '缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY（写在 .env 里，CI 里用 secrets 注入）' : '缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY',
    );
  }
  return createStorage({ url, key });
};

/** 库里三张表 → 一份缓存对象；status 按 url 建索引，icons 按 host 建映射，与旧数据文件形状一致 */
export const pullCache = async (client = clientFor()) => {
  const [rows, statusRows, iconRows] = await Promise.all([client.listLinks(), client.listStatus(), client.listIcons()]);
  const status = {};
  for (const row of statusRows) status[row.url] = row;
  const icons = {};
  for (const row of iconRows) if (row.file) icons[row.host] = row.file;
  return { syncedAt: new Date().toISOString(), links: rows, status, icons };
};

export const writeCache = (data, file = cachePath()) => {
  mkdirSync(dirname(file), { recursive: true });
  // 同步和编辑可能并行；读者只能看见完整的一版。
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temp, file);
  return file;
};

/** 拉一次并落盘；构建、开发、以及每次写入之后都调它 */
export const refreshCache = async (client) => {
  const data = await pullCache(client ?? clientFor());
  writeCache(data);
  return data;
};

export const readCache = (file = cachePath()) => JSON.parse(readFileSync(file, 'utf8'));
