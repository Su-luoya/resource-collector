// 数据层的纯逻辑：序列化 + 校验。
//
// 被两处共用，避免规则漂移：
//   - scripts/validate.mjs（`npm run check`，node 直跑）
//   - src/middleware.ts（dev 编辑端点，写盘前先校验）
//
// 约束：本文件不许 import 任何 node 内建模块，也不许出现 Vite 专有导入，
// 否则 `node scripts/validate.mjs` 会挂。
import { parse } from 'yaml';

export const FIELDS = ['title', 'url', 'type', 'topics', 'desc', 'added'];

/** 双引号标量：与仓库现有写法一致（title/desc 带引号，url/type/added 不带） */
const q = (value) =>
  '"' +
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t') +
  '"';

/**
 * 域名规范化：去掉 www.、统一小写。
 * 图标表（src/data/icons.json）的键与页面查图标的键必须是同一把，否则 www 站点的图标全部查不到。
 * 入参可以是完整 URL 或裸域名。
 */
export const hostKey = (input) => {
  const text = String(input ?? '').trim();
  if (!text) return '';
  try {
    const url = text.includes('://') ? new URL(text) : new URL(`https://${text}`);
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
};

/** 块状 plain 标量里只有空白和「: 」会被误读；其余原样输出，保持与现有文件逐字节一致 */
const plain = (value) => (/\s|: /.test(value) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ? q(value) : value);

const dumpOne = (r) =>
  `- title: ${q(r.title)}\n` +
  `  url: ${plain(r.url)}\n` +
  `  type: ${r.type}\n` +
  `  topics: [${(r.topics ?? []).join(', ')}]\n` +
  `  desc: ${q(r.desc)}\n` +
  `  added: ${r.added}\n`;

export const parseLinks = (raw) => {
  const parsed = parse(raw);
  const rows = Array.isArray(parsed) ? parsed : (parsed?.links ?? []);
  return rows.map((r) => ({ ...r, topics: r.topics ?? [] }));
};

/**
 * 全表重排。头部注释原样保留（取到第一条 `- title:` 之前），
 * 其余每条按固定模板输出——对现有 99 条是逐字节复现，所以改一条只有一条的 diff。
 */
export const dumpLinks = (rows, raw) => {
  const at = raw.indexOf('- title:');
  const head = at === -1 ? '' : raw.slice(0, at);
  return head + rows.map(dumpOne).join('\n');
};

const isParseable = (value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * @returns {{errors: string[], warns: string[]}}
 */
export const validateRows = (rows, taxonomy, today = new Date().toISOString().slice(0, 10)) => {
  const typeIds = new Set(taxonomy.types.map((t) => t.id));
  const topicIds = new Set(taxonomy.topics.map((t) => t.id));
  const errors = [];
  const warns = [];
  const err = (m) => errors.push(m);

  if (!Array.isArray(rows)) {
    return { errors: ['links.yaml 顶层必须是链接数组'], warns };
  }

  const seen = new Map();

  rows.forEach((l, i) => {
    const at = `links[${i}]`;
    if (!l || typeof l !== 'object') return err(`${at} 不是对象`);

    for (const k of ['title', 'url', 'desc']) {
      if (typeof l[k] !== 'string' || !l[k].trim()) err(`${at}.${k} 缺失或为空`);
    }
    if (typeof l.title === 'string' && l.title.length > 80) err(`${at}.title 超过 80 字`);
    if (typeof l.desc === 'string' && l.desc.length > 120) err(`${at}.desc 超过 120 字（卡片会截断）`);

    if (typeof l.url === 'string') {
      if (!/^https?:\/\//.test(l.url)) err(`${at}.url 必须以 http(s):// 开头：${l.url}`);
      else if (/\s/.test(l.url)) err(`${at}.url 含空白字符：${JSON.stringify(l.url)}`);
      else if (!isParseable(l.url)) err(`${at}.url 解析失败：${l.url}`);

      // 用 has() 而不是取值判断：首条就是 links[0]，下标 0 是 falsy
      if (seen.has(l.url)) err(`${at}.url 与 links[${seen.get(l.url)}] 重复：${l.url}`);
      else seen.set(l.url, i);
    }

    if (typeof l.type !== 'string' || !l.type.trim()) err(`${at}.type 缺失（必须是 taxonomy.json 里的一个类型 id）`);
    else if (!typeIds.has(l.type)) err(`${at}.type 未登记：${l.type}（可选：${[...typeIds].join(', ')}）`);

    if (!Array.isArray(l.topics)) err(`${at}.topics 必须是数组（可为空，但字段要写）`);
    else {
      const seenTopic = new Set();
      for (const t of l.topics) {
        if (typeof t !== 'string' || !/^[a-z0-9-]+$/.test(t)) err(`${at}.topics 含非法取值：${JSON.stringify(t)}`);
        else if (!topicIds.has(t)) err(`${at}.topics 未登记：${t}（可选：${[...topicIds].join(', ')}）`);
        else if (seenTopic.has(t)) err(`${at}.topics 重复：${t}`);
        else seenTopic.add(t);
      }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.added ?? ''))) err(`${at}.added 必须是 YYYY-MM-DD`);
    else if (String(l.added) > today) warns.push(`${at}.added 是未来日期：${l.added}`);
  });

  for (const l of rows) {
    if (typeof l.url === 'string' && /^http:\/\//.test(l.url)) warns.push(`非 HTTPS 链接：${l.url}`);
  }

  return { errors, warns };
};

/** 按 url 对比两份表，给出 新增 / 删除 / 修改 的条数，供发布消息与状态提示使用 */
export const diffRows = (before, after) => {
  const prev = new Map(before.map((r) => [r.url, r]));
  const next = new Map(after.map((r) => [r.url, r]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [url] of next) if (!prev.has(url)) added++;
  for (const [url, row] of prev) {
    if (!next.has(url)) removed++;
    else if (JSON.stringify(next.get(url)) !== JSON.stringify(row)) changed++;
  }
  return { added, removed, changed };
};
