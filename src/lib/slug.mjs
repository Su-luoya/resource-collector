// 每条资源的稳定地址片段。
//
// 只由 URL 推导，不含「第几条」这种会随增删漂移的信息——否则收藏过的详情页链接会烂掉。
// 同一 URL 永远得到同一 slug；不同 URL 撞在一起时按 URL 排序追加 -2 / -3，保证结果确定。

const MAX = 72;

/** 只保留对 URL 有意义的部分：域名（去掉 www）+ 路径，丢掉协议、查询与锚点 */
const skeleton = (input) => {
  const text = String(input ?? '').trim();
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (!/^https?:$/.test(url.protocol)) return '';
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  // 中文/空格在 pathname 里是百分号编码；先还原，否则 slug 会变成一长串十六进制
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // 非法百分号序列保持原样，交给下面的字符过滤兜底
  }
  return `${host}${path}`;
};

export const slugOf = (input) => {
  const raw = skeleton(input);
  if (!raw) return '';
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX)
    .replace(/-+$/g, '');
  return slug;
};

/**
 * 全库 slug 表：url → slug。
 * 撞车时按 URL 字典序分配后缀，跟文件里的先后顺序无关，因此重排 YAML 不会改地址。
 */
export const slugMap = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const slug = slugOf(row?.url);
    if (!slug) continue;
    (groups.get(slug) ?? groups.set(slug, []).get(slug)).push(row.url);
  }

  const map = new Map();
  for (const [slug, urls] of groups) {
    const sorted = [...new Set(urls)].sort();
    sorted.forEach((url, i) => map.set(url, i === 0 ? slug : `${slug}-${i + 1}`));
  }
  return map;
};
