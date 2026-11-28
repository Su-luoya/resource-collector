// 从浏览器导出的书签 HTML 里抽链接。只取标题、地址与所在文件夹，不还原整棵书签树。
import { decodeEntities, normUrl } from './dev-meta.mjs';

/**
 * Netscape 书签格式：`<DT><H3>文件夹</H3>` 与 `<DT><A HREF="…">标题</A>` 交替出现。
 * 文件夹只取最近一个 H3（够用来提示来源），不还原嵌套。
 *
 * - 非 http(s) 的连接（javascript:、chrome:// 之类）计入 skipped
 * - 同一地址重复出现只保留第一次，静默去重（浏览器导出经常有重复）
 */
export const parseBookmarks = (html) => {
  const src = typeof html === 'string' ? html : '';
  const items = [];
  const seen = new Set();
  let skipped = 0;
  let total = 0;

  const pattern = /<dt>\s*<h3\b[^>]*>([\s\S]*?)<\/h3>|<dt>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  let folder = '';
  while ((match = pattern.exec(src))) {
    if (match[1] !== undefined) {
      folder = decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 60);
      continue;
    }
    total++;
    const attrs = match[2] || '';
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? /\bhref\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ?? '';
    const target = /^https?:/i.test(href) ? normUrl(decodeEntities(href)) : { url: '' };
    if (!target.url) {
      skipped++;
      continue;
    }
    if (seen.has(target.url)) continue;
    seen.add(target.url);
    items.push({
      url: target.url,
      title: decodeEntities(match[3].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 120),
      folder,
    });
  }

  return { items, skipped, total };
};

/** 书签里存的标题常是「页面标题 - 站点名」或空白，清一下 */
export const tidyTitle = (title, url) => {
  const raw = String(title ?? '').replace(/\s+/g, ' ').trim();
  const cleaned = raw.replace(/\s+[-–—|·]\s+[^-–—|·]{1,40}$/, '').trim();
  if (cleaned) return cleaned.slice(0, 80);
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url ?? '').slice(0, 80);
  }
};
