import { urlKey } from './link-data.mjs';

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'spm',
  '_hsenc', '_hsmi',
]);

/** 只识别明确的跟踪参数；返回建议，绝不自动改写数据。 */
export const cleanupUrl = (input) => {
  const url = new URL(input);
  const removed = [];
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMS.has(key.toLowerCase())) {
      if (!removed.includes(key)) removed.push(key);
      url.searchParams.delete(key);
    }
  }
  return removed.length ? { url: url.href, removed } : null;
};

const hostOnly = (input) => new URL(input).hostname.toLowerCase().replace(/^www\./, '');

/** 仅用于相似候选：忽略协议、www、锚点、跟踪参数和查询参数顺序。 */
const comparisonKey = (input) => {
  const clean = cleanupUrl(input);
  const url = new URL(clean ? clean.url : input);
  url.hostname = hostOnly(url.href);
  if (url.protocol === 'http:') url.protocol = 'https:';
  url.hash = '';
  url.searchParams.sort();
  return urlKey(url.href);
};

const cleanedKey = (input) => {
  const clean = cleanupUrl(input);
  return urlKey(clean ? clean.url : input);
};

const normTitle = (title) => String(title || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, '');

/**
 * 返回少量可解释的候选，不做自动合并，也不阻止保存。
 * 只有 URL 变体，或「同站点 + 完全同名（忽略标点/空白）」才会进入候选。
 */
export const findDuplicateCandidates = ({ url, title = '', rows, excludeUrl = '', limit = 5 }) => {
  const exactKey = urlKey(url);
  const cleanKey = cleanedKey(url);
  const compareKey = comparisonKey(url);
  const titleKey = normTitle(title);
  const excluded = excludeUrl ? urlKey(excludeUrl) : '';
  const candidates = [];

  for (const row of rows) {
    if (excluded && urlKey(row.url) === excluded) continue;
    let score = 0;
    let reason = '';
    if (urlKey(row.url) === exactKey) {
      score = 100;
      reason = 'URL 已存在';
    } else if (cleanedKey(row.url) === cleanKey) {
      score = 95;
      reason = '清理跟踪参数后相同';
    } else if (comparisonKey(row.url) === compareKey) {
      score = 85;
      reason = '可能是同一页面的 URL 变体';
    } else if (titleKey && normTitle(row.title) === titleKey && hostOnly(row.url) === hostOnly(url)) {
      score = 60;
      reason = '同站点、同名资源';
    }
    if (score) candidates.push({ row, reason, score });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title, 'zh-CN'))
    .slice(0, limit)
    .map(({ row, reason }) => ({ row, reason }));
};

/**
 * 全库查重：只报三种能确定的重复，不猜。
 * 同一对条目可能同时命中多条规则（例如清参数后相同、URL 文本也相同），按「强规则优先」去重，
 * 每组内用 url 当身份，避免标题相同但 URL 不同的条目被错并。
 */
const RULE_LABEL = {
  same_url: 'URL 归一化后相同',
  same_cleaned: '去掉跟踪参数后相同',
  same_host_title: '同站点且标题相同',
};

export const scanDuplicates = (rows) => {
  const groups = [];
  const seen = new Set();

  const collect = (kind, keyOf, { requireTitle = false } = {}) => {
    const buckets = new Map();
    rows.forEach((row, index) => {
      const key = keyOf(row);
      if (!key) return;
      if (requireTitle && !normTitle(row.title)) return;
      const bucket = buckets.get(key) ?? [];
      bucket.push({ index, row });
      buckets.set(key, bucket);
    });
    for (const [, items] of buckets) {
      if (items.length < 2) continue;
      const keys = items.map((item) => urlKey(item.row.url)).sort();
      // 用「行集合」去重（不带 kind）：同一批条目已经被更强的规则报过，就不再重复报一遍
      const id = keys.join('|');
      if (seen.has(id)) continue;
      seen.add(id);
      groups.push({
        kind,
        label: RULE_LABEL[kind],
        items: items.map((item) => item.row),
      });
    }
  };

  // 强规则先跑：它们的命中更具体，弱规则里重复的组会被 seen 拦掉
  collect('same_url', (row) => urlKey(row.url));
  collect('same_cleaned', (row) => cleanedKey(row.url));
  collect('same_host_title', (row) => {
    const host = hostOnly(row.url);
    const title = normTitle(row.title);
    return host && title ? `${host}\u0000${title}` : '';
  }, { requireTitle: true });

  return { checked: rows.length, groups };
};
