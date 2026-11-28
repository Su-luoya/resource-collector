/**
 * 图标落盘：把库里 `icons` 表指向的对象从 Storage 下到 `public/icons/`。
 *
 * 图标字节的唯一事实源是 Storage，仓库里不再有图片文件。构建前（`npm run sync`）
 * 补齐本地缺失的那些，产物里就是普通静态文件，线上零外部依赖。
 *
 * 下载失败只警告不中断：图标缺了页面退化成首字母占位，不该因此停掉整次构建。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, readCache, storageFor } from './cloud-sync.mjs';
import { objectName } from './storage.mjs';

const CONCURRENCY = 6;

export const iconsDir = (dir = root) => resolve(dir, 'public/icons');

/** 表里有、本地没有的都补下来；`force` 连已有的也重下一遍（换机器/修坏文件用） */
export const syncIcons = async ({ force = false, dir, cache, storage, log = () => {} } = {}) => {
  const icons = (cache ?? readCache()).icons ?? {};
  const outDir = iconsDir(dir);
  mkdirSync(outDir, { recursive: true });

  const queue = [];
  for (const [host, file] of Object.entries(icons)) {
    const target = resolve(outDir, objectName(file));
    if (!force && existsSync(target)) continue;
    queue.push({ host, file, target });
  }

  const total = Object.keys(icons).length;
  if (!queue.length) return { total, downloaded: 0, failed: [] };

  const client = storage ?? storageFor();
  const failed = [];
  let downloaded = 0;

  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        const bytes = await client.download(job.file);
        if (!bytes) throw new Error('对象不存在');
        writeFileSync(job.target, bytes);
        downloaded++;
        log(`✓ ${job.host}`);
      } catch (error) {
        failed.push(job.host);
        log(`✗ ${job.host}（${error.message}）`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { total, downloaded, failed };
};
