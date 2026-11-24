// 数据层的纯逻辑：序列化 + 校验。
//
// 命令行、站点构建与 dev 编辑端点共用同一套规则。
//
// 约束：本文件不许 import 任何 node 内建模块，也不许出现 Vite 专有导入，
// 否则 `node scripts/validate.mjs` 会挂。
import { parse } from 'yaml';

const FIELDS = ['title', 'url', 'section', 'facets', 'desc', 'added', 'pin', 'note', 'read'];

/** 双引号标量：与仓库现有写法一致（title/desc 带引号，url/section/added 不带） */
const q = JSON.stringify;

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

/** http(s) URL 含空白或以冒号结尾时不能原样写入 YAML */
const plain = (url) => (/\s|:$/.test(url) ? q(url) : url);

/** 单值写成 `code`，多值写成 `[r, python]`；facet 取值都是小写 id，不需要引号 */
const inline = (value) => (Array.isArray(value) ? `[${value.join(', ')}]` : String(value));

const dumpFacets = (facets) =>
  Object.entries(facets ?? {}).map(
    ([section, values]) =>
      `    ${section}: { ${Object.entries(values)
        .map(([id, value]) => `${id}: ${inline(value)}`)
        .join(', ')} }`,
  );

/** 多行笔记写成 YAML 块标量：`|` 保留换行，`-` 表示不带结尾换行，跟字段值逐字一致 */
const dumpNote = (note) => {
  const text = String(note ?? '');
  if (!text) return [];
  if (!text.includes('\n')) return [`  note: ${q(text)}`];
  const lines = text.split('\n').map((line) => (line ? `    ${line}` : ''));
  return ['  note: |-', ...lines];
};

const dumpOne = (r) =>
  [
    `- title: ${q(r.title)}`,
    `  url: ${plain(r.url)}`,
    `  section: [${(r.section ?? []).join(', ')}]`,
    '  facets:',
    ...dumpFacets(r.facets),
    `  desc: ${q(r.desc)}`,
    `  added: ${r.added}`,
    // 只有置顶才写这一行：不加字段的数据与以前逐字一致，diff 不会无限长
    ...(r.pin === true ? ['  pin: true'] : []),
    // 同理，只有待看才写 read: false；没标记的条目保持原样
    ...(r.read === false ? ['  read: false'] : []),
    ...dumpNote(r.note),
  ].join('\n') + '\n';

const headerOf = (raw) => raw.match(/^(?:[ \t]*(?:#.*)?(?:\r?\n|$))*/)[0];

export const parseLinks = (raw) => {
  const parsed = parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.links) && Object.keys(parsed).length === 1) return parsed.links;
  // 旧版编辑器删光后只留下头部注释；其它非数组的文档不能当作空库写回。
  if (parsed === null && headerOf(raw) === raw) return [];
  throw new Error('links.yaml 顶层必须是链接数组');
};

/** 保留头部注释，其余按固定模板输出；对现有数据逐字节复现。 */
export const dumpLinks = (rows, raw) => {
  const head = headerOf(raw);
  const body = rows.length ? rows.map(dumpOne).join('\n') : '[]\n';
  return head && !head.endsWith('\n') ? head + '\n' + body : head + body;
};

/** 只忽略路径末尾的斜杠；查询值与锚点中的斜杠仍是主键的一部分。 */
export const urlKey = (value) => {
  const url = URL.parse(value);
  if (!url) return null;
  url.pathname = url.pathname.replace(/\/$/, '');
  return url.href;
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
    if (!l || typeof l !== 'object' || Array.isArray(l)) return err(`${at} 不是对象`);

    for (const k of ['title', 'url', 'desc']) {
      if (typeof l[k] !== 'string' || !l[k].trim()) err(`${at}.${k} 缺失或为空`);
    }
    if (typeof l.title === 'string' && l.title.length > 80) err(`${at}.title 超过 80 字`);
    if (typeof l.desc === 'string' && l.desc.length > 120) err(`${at}.desc 超过 120 字（卡片会截断）`);

    for (const k of Object.keys(l)) {
      if (k === 'type' || k === 'topics') err(`${at}.${k} 已废弃，改用 section + facets`);
      else if (!FIELDS.includes(k)) err(`${at}.${k} 未登记，编辑器不能写回此字段`);
    }

    // 置顶是可选的布尔；写 false 没意义，但不算错（手写 YAML 时容易残留）
    if (l.pin !== undefined && typeof l.pin !== 'boolean') err(`${at}.pin 必须是 true / false`);

    // 待看标记：只有 read: false 有意义，其余一律当作未标记
    if (l.read !== undefined && typeof l.read !== 'boolean') err(`${at}.read 必须是 true / false`);

    // 笔记是可选的 Markdown；不写就不出现，不占卡片空间
    if (l.note !== undefined) {
      if (typeof l.note !== 'string') err(`${at}.note 必须是字符串`);
      else if (l.note.length > 4000) err(`${at}.note 超过 4000 字`);
    }

    if (typeof l.url === 'string') {
      const key = urlKey(l.url);
      if (!/^https?:\/\//.test(l.url)) err(`${at}.url 必须以 http(s):// 开头：${l.url}`);
      else if (/\s/.test(l.url)) err(`${at}.url 含空白字符：${JSON.stringify(l.url)}`);
      else if (!key) err(`${at}.url 解析失败：${l.url}`);
      else if (seen.has(key)) err(`${at}.url 与 links[${seen.get(key)}] 重复：${l.url}`);
      else seen.set(key, i);
      if (l.url.startsWith('http://')) warns.push(`非 HTTPS 链接：${l.url}`);
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

    const date = l.added;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toJSON()?.slice(0, 10) !== date) {
      err(`${at}.added 必须是 YYYY-MM-DD 格式的有效日期`);
    } else if (date > today) warns.push(`${at}.added 是未来日期：${date}`);
  });

  return { errors, warns };
};

/**
 * 结构化 diff，供发布前确认。
 * URL 是主键；但唯一同名行的一删一增通常是「修改 URL」，配成 changed 展示前后值。
 * 同名不唯一时不猜测，仍按删除 + 新增处理。
 */
export const diffRowDetails = (before, after) => {
  const prev = new Map(before.map((r) => [urlKey(r.url), r]));
  const next = new Map(after.map((r) => [urlKey(r.url), r]));
  const changed = [];
  for (const [key, row] of next) {
    if (prev.has(key) && JSON.stringify(prev.get(key)) !== JSON.stringify(row)) {
      changed.push({ before: prev.get(key), after: row });
    }
  }

  const oldUnmatched = before.filter((r) => !next.has(urlKey(r.url)));
  const newUnmatched = after.filter((r) => !prev.has(urlKey(r.url)));
  const countTitles = (list) => {
    const map = new Map();
    for (const r of list) map.set(r.title, (map.get(r.title) ?? 0) + 1);
    return map;
  };
  const beforeTitles = countTitles(before);
  const afterTitles = countTitles(after);
  const pairedOld = new Set();
  const pairedNew = new Set();
  for (const oldRow of oldUnmatched) {
    // 标题在两张表里都唯一时才配对：同名资源（如一堆 "GitHub"）时配对会把删除藏起来。
    if (beforeTitles.get(oldRow.title) !== 1 || afterTitles.get(oldRow.title) !== 1) continue;
    const match = newUnmatched.find((r) => r.title === oldRow.title && !pairedNew.has(r));
    if (!match) continue;
    pairedOld.add(oldRow);
    pairedNew.add(match);
    changed.push({ before: oldRow, after: match });
  }

  return {
    added: newUnmatched.filter((r) => !pairedNew.has(r)),
    removed: oldUnmatched.filter((r) => !pairedOld.has(r)),
    changed,
  };
};

/** 按 url 对比两份表，给出 新增 / 删除 / 修改 的条数，供发布消息与状态提示使用 */
export const diffRows = (before, after) => {
  const details = diffRowDetails(before, after);
  return { added: details.added.length, removed: details.removed.length, changed: details.changed.length };
};
