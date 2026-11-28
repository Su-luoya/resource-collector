#!/usr/bin/env node
// 把 Supabase 里的数据拉成构建用的缓存 .cache/links.json，并把图标从 Storage 落到 public/icons/。
// 构建、开发、周检前都会跑它；库是唯一事实源，缓存与图标文件都只是本地快照。
import { refreshCache } from '../src/lib/cloud-sync.mjs';
import { syncIcons } from '../src/lib/icon-sync.mjs';

try {
  const data = await refreshCache();
  const icons = await syncIcons({ cache: data });
  const parts = [
    `资源 ${data.links.length}`,
    `体检 ${Object.keys(data.status).length}`,
    `图标 ${icons.total}${icons.downloaded ? `（新下载 ${icons.downloaded}）` : ''}`,
  ];
  console.log(`✓ 同步完成：${parts.join(' · ')} → .cache/links.json`);
  if (icons.failed.length) {
    console.warn(`⚠ ${icons.failed.length} 个图标没能从 Storage 取到，页面用首字母占位：${icons.failed.join(', ')}`);
  }
} catch (error) {
  console.error(`✗ 同步失败：${error.message}`);
  process.exit(1);
}
