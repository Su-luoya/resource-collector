// 数据层的纯逻辑：序列化 + 校验。
//
// 被两处共用，避免规则漂移：
//   - scripts/validate.mjs（`npm run check`，node 直跑）
//   - src/middleware.ts（dev 编辑端点，写盘前先校验）
//
// 约束：本文件不许 import 任何 node 内建模块，也不许出现 Vite 专有导入，
// 否则 `node scripts/validate.mjs` 会挂。
import { parse } from 'yaml';

export const FIELDS = ['title', 'url', 'section', 'facets', 'desc', 'added'];

/** 双引号标量：与仓库现有写法一致（title/desc 带引号，url/section/added 不带） */
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

/** 单值写成 `code`，多值写成 `[r, python]`；facet 取值都是小写 id，不需要引号 */
const inline = (value) => (Array.isArray(value) ? `[${value.join(', ')}]` : String(value));

const dumpFacets = (facets) =>
  Object.entries(facets ?? {}).map(
    ([section, values]) =>
      `    ${section}: { ${Object.entries(values)
        .map(([id, value]) => `${id}: ${inline(value)}`)
        .join(', ')} }`,
  );

const dumpOne = (r) =>
  [
    `- title: ${q(r.title)}`,
    `  url: ${plain(r.url)}`,
    `  section: [${(r.section ?? []).join(', ')}]`,
    '  facets:',
    ...dumpFacets(r.facets),
    `  desc: ${q(r.desc)}`,
    `  added: ${r.added}`,
  ].join('\n') + '\n';

export const parseLinks = (raw) => {
  const parsed = parse(raw);
  const rows = Array.isArray(parsed) ? parsed : (parsed?.links ?? []);
  return rows;
};

/**
 * 全表重排。头部注释原样保留（取到第一条 `- title:` 之前），
 * 其余每条按固定模板输出——对现有数据是逐字节复现，所以改一条只有一条的 diff。
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

const idOk = (value) => typeof value === 'string' && /^[a-z0-9-]+$/.test(value);

/**
 * links.yaml 的行校验。
 * section 是对外概念（决定进哪几页），facets 按分区嵌套（同名的 kind 轴在不同页面互不干扰）。
 * @returns {{errors: string[], warns: string[]}}
 */
export const validateRows = (rows, taxonomy, today = new Date().toISOString().slice(0, 10)) => {
  const sections = taxonomy.sections ?? [];
  const byId = new Map(sections.map((s) => [s.id, s]));
  const sectionList = [...byId.keys()].join(', ');
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

    // 旧字段：分面模型换过一次，留着会让人以为还在用
    for (const old of ['type', 'topics']) {
      if (old in l) err(`${at}.${old} 已废弃，改用 section + facets`);
    }

    if (typeof l.url === 'string') {
      if (!/^https?:\/\//.test(l.url)) err(`${at}.url 必须以 http(s):// 开头：${l.url}`);
      else if (/\s/.test(l.url)) err(`${at}.url 含空白字符：${JSON.stringify(l.url)}`);
      else if (!isParseable(l.url)) err(`${at}.url 解析失败：${l.url}`);

      // 用 has() 而不是取值判断：首条就是 links[0]，下标 0 是 falsy
      if (seen.has(l.url)) err(`${at}.url 与 links[${seen.get(l.url)}] 重复：${l.url}`);
      else seen.set(l.url, i);
    }

    const picked = new Set();
    if (!Array.isArray(l.section) || l.section.length === 0) {
      err(`${at}.section 必须是非空数组（可多值，如 [data, packages]）`);
    } else {
      for (const id of l.section) {
        if (!idOk(id)) err(`${at}.section 含非法取值：${JSON.stringify(id)}`);
        else if (!byId.has(id)) err(`${at}.section 未登记：${id}（可选：${sectionList}）`);
        else if (picked.has(id)) err(`${at}.section 重复：${id}`);
        else picked.add(id);
      }
    }

    if (!l.facets || typeof l.facets !== 'object' || Array.isArray(l.facets)) {
      err(`${at}.facets 必须是对象，键为分区 id`);
      return;
    }

    for (const key of Object.keys(l.facets)) {
      if (!picked.has(key)) err(`${at}.facets.${key} 不在 section 里（先把它加进 section）`);
    }

    for (const sid of picked) {
      const def = byId.get(sid);
      if (!def) continue; // 未登记的分区已经报过
      const got = l.facets[sid];
      if (!got || typeof got !== 'object' || Array.isArray(got)) {
        err(`${at}.facets.${sid} 缺失（每个 section 都要写它自己的分类）`);
        continue;
      }

      const facetIds = new Set((def.facets ?? []).map((f) => f.id));
      for (const fid of Object.keys(got)) {
        if (!facetIds.has(fid)) {
          err(`${at}.facets.${sid}.${fid} 不在该分区词表里（可选：${[...facetIds].join(', ')}）`);
        }
      }

      for (const facet of def.facets ?? []) {
        const value = got[facet.id];
        if (value === undefined) {
          err(`${at}.facets.${sid}.${facet.id} 缺失（可选：${facet.values.map((v) => v.id).join(', ')}）`);
          continue;
        }
        const allowed = new Set(facet.values.map((v) => v.id));
        const list = Array.isArray(value) ? value : [value];
        if (facet.multi && !Array.isArray(value)) err(`${at}.facets.${sid}.${facet.id} 可多选，必须写成数组`);
        if (!facet.multi && Array.isArray(value)) err(`${at}.facets.${sid}.${facet.id} 单选，不能写成数组`);
        const used = new Set();
        for (const v of list) {
          if (!idOk(v)) err(`${at}.facets.${sid}.${facet.id} 含非法取值：${JSON.stringify(v)}`);
          else if (!allowed.has(v)) {
            err(`${at}.facets.${sid}.${facet.id} 未登记：${v}（可选：${[...allowed].join(', ')}）`);
          } else if (used.has(v)) err(`${at}.facets.${sid}.${facet.id} 重复：${v}`);
          else used.add(v);
        }
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
