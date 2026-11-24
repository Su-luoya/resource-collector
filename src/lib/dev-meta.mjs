// dev 编辑端点的纯逻辑：URL 归一化、文本清洗、从 HTML 里抽 title / description。
//
// 从 src/middleware.ts 拆出来只有一个原因：这些函数没有副作用、不碰文件系统，
// 可以 `node --test` 直接跑。约束同 link-data.mjs：不许 import 任何 node 内建模块。

/** 折叠空白并截断；截断点不落在代理对中间，避免出现半个 emoji */
export const clean = (value, max) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

/**
 * 归一化用户填进来的链接：补 https://、scheme 转小写、拒绝非 http(s) 与含空白的输入。
 * @returns {{url?: string, error?: string}}
 */
export const normUrl = (input) => {
  let url = String(input ?? '').trim();
  if (!url) return { error: 'URL 不能为空' };

  if (!/^https?:\/\//i.test(url)) {
    const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme) return { error: `只接受 http(s) 链接，收到 ${scheme[1]}:` };
    url = `https://${url}`;
  }
  url = url.replace(/^([a-z][a-z0-9+.-]*):\/\//i, (_, scheme) => `${scheme.toLowerCase()}://`);

  if (/\s/.test(url)) return { error: 'URL 里不能有空白字符' };
  try {
    // 用 href 而不是原串：host 转小写、去掉 :443 之类的默认端口、根路径补斜杠，
    // 这样同一个站点换种写法也不会在数据里出现两条。
    return { url: new URL(url).href };
  } catch {
    return { error: `URL 解析失败：${url}` };
  }
};

const safeChar = (code) => {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
};

const NAMED = {
  amp: '&', // 单遍替换，所以 "&amp;lt;" 只会变成 "&lt;"，不会被二次解码成 "<"
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lt: '<',
  gt: '>',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  middot: '\u00b7',
  times: '\u00d7',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
};

// 单遍命名实体替换：未知实体原样保留，避免把别人的 `&foo;` 吃掉
export const decodeEntities = (text) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED[name.toLowerCase()] ?? whole);

/** 标题/描述里偶尔混进行内标签，去掉以免把 `<b>` 写进 YAML */
const stripTags = (text) => text.replace(/<[^>]*>/g, ' ');

/**
 * 抽可读正文，供 AI 生成时当唯一事实来源。够用即可：不引 HTML 解析器。
 * 先掐掉不会出现在正文里的块（注释、script/style/noscript/svg/template/head），再去标签、解实体、折叠空白。
 */
export const htmlToText = (html, limit = 6000) => {
  const src = typeof html === 'string' ? html : '';
  const stripped = src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:br|hr|p|div|li|tr|h[1-6]|section|article|header|footer|nav)\b[^>]*>/gi, ' · ')
    .replace(/<[^>]*>/g, ' ');
  return clean(decodeEntities(stripped), limit);
};

/**
 * 从一段 HTML 里取 title 与 description，够用即可：不引 HTML 解析器。
 * @returns {{title: string, desc: string, source: 'description' | 'og' | ''}}
 */
export const extractMeta = (html) => {
  const src = typeof html === 'string' ? html : '';
  const title = decodeEntities(stripTags(src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''));
  let desc = '';
  let source = '';
  for (const tag of src.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    if (!['description', 'og:description', 'twitter:description'].includes(name)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (!content.trim()) continue;
    desc = decodeEntities(stripTags(content));
    source = name === 'description' ? 'description' : 'og';
    if (name === 'description') break; // 优先 <meta name="description">
  }
  return { title: clean(title, 80), desc: clean(desc, 120), source };
};
