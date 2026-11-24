#!/usr/bin/env node
// 把 Supabase 里的数据拉成构建用的缓存 .cache/links.json。
// 构建、开发、周检前都会跑它；库是唯一事实源，缓存只是本地快照。
import { refreshCache } from '../src/lib/cloud-sync.mjs';

try {
  const data = await refreshCache();
  console.log(
    `✓ 同步完成：资源 ${data.links.length} · 体检 ${Object.keys(data.status).length} · 图标 ${Object.keys(data.icons).length} → .cache/links.json`,
  );
} catch (error) {
  console.error(`✗ 同步失败：${error.message}`);
  process.exit(1);
}
