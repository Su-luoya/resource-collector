/**
 * 云端行 ↔ 内部资源对象的互相转换，以及 Supabase REST 的最小封装。
 *
 * 内部表示沿用 YAML 时代的样子（section 数组、facets 嵌套、缺省就没有的 pin/note/read），
 * 这样页面、校验、编辑层全都不用改。只有两个字段名不一样：
 *   - 库里 `unread` 是正着说的布尔列，内部沿用 `read: false` 表示待看
 *   - 库里 `desc` 是保留字冲突列（建表时加了引号），内部仍是 desc
 *
 * 本文件不 import node 内建模块，chunk 纯函数可直接被 node --test 跑。
 */

/** 内部对象 → 写库行。空 note 与「已读」都不写值，避免把 undefined 变成 null 之外的怪东西。 */
export const toRow = (link) => {
  const row = {
    url: link.url,
    title: link.title,
    section: Array.isArray(link.section) ? [...link.section] : [],
    facets: link.facets && typeof link.facets === 'object' ? link.facets : {},
    desc: link.desc,
    added: link.added,
    pin: link.pin === true,
    unread: link.read === false,
    // 必须显式给 null：缺键的合并更新不会把旧笔记清掉
    note: typeof link.note === 'string' && link.note.trim() ? link.note : null,
  };
  return row;
};

/** 写库行 → 内部对象。只带出有意义的可选字段，缺省即「没有」。 */
export const fromRow = (row) => {
  const link = {
    title: row.title,
    url: row.url,
    section: Array.isArray(row.section) ? [...row.section] : [],
    facets: row.facets && typeof row.facets === 'object' ? row.facets : {},
    desc: row.desc,
    added: typeof row.added === 'string' ? row.added.slice(0, 10) : String(row.added ?? '').slice(0, 10),
  };
  if (row.pin === true) link.pin = true;
  if (typeof row.note === 'string' && row.note.trim()) link.note = row.note;
  if (row.unread === true) link.read = false;
  return link;
};

/** 体检行的形状统一在这里，避免各处各写一遍字段名 */
export const fromStatusRow = (row) => {
  const info = { url: row.url, status: row.status };
  if (Number.isFinite(row.code)) info.code = row.code;
  // 库里叫 target，界面上叫 final（最终地址）；重定向链只在探测过程中用，不落库
  if (typeof row.target === 'string' && row.target) info.final = row.target;
  if (typeof row.error === 'string' && row.error) info.error = row.error;
  if (typeof row.checked === 'string' && row.checked) info.checked = row.checked.slice(0, 10);
  return info;
};

export const toStatusRow = (info) => {
  const row = { url: info.url, status: info.status, checked: info.checked };
  if (Number.isFinite(info.code)) row.code = info.code;
  if (info.final) row.target = info.final;
  if (info.error) row.error = info.error;
  return row;
};

export const toIconRow = ({ host, file, missedAt }) => {
  const row = { host, file: file ?? null, missed_at: file ? null : (missedAt ?? new Date().toISOString()) };
  return row;
};

/**
 * Supabase REST 客户端。只依赖全局 fetch，测试里可以塞自造的 fetch。
 * table 走 /rest/v1/<table>，鉴权头按 key 类型自动选：publishable/sb_publishable_ 当 apikey，
 * service/secret 还额外当 Bearer。
 */
export const createClient = ({ url, key, fetchImpl = fetch, schema = 'public' }) => {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(schema === 'public' ? {} : { 'Accept-Profile': schema, 'Content-Profile': schema }),
  };

  const request = async (method, path, { body, prefer } = {}) => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      const detail = text.trim().slice(0, 300) || res.statusText;
      throw new Error(`${method} ${path} 失败：HTTP ${res.status} ${detail}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const selectAll = async (table, query = 'select=*') => {
    const rows = await request('GET', `/${table}?${query}`);
    return Array.isArray(rows) ? rows : [];
  };

  /** PostgREST 的 in.(...) 里带逗号的 URL 必须加双引号，否则会被当成两个值 */
  const quoteList = (values) => values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(',');

  return {
    /**
     * 整表对齐：先 upsert 本次的行，再删掉库里多出来的行。
     * 删除名单靠先查一遍现有 url 求出，不把 95 条拼进请求头以外的字符串里，也避免 URL 含逗号时切错。
     */
    replaceLinks: async (links) => {
      const rows = links.map(toRow);
      const existing = (await selectAll('links', 'select=url')).map((row) => row.url);
      const keep = new Set(rows.map((row) => row.url));
      const stale = existing.filter((url) => !keep.has(url));
      if (rows.length) await request('POST', '/links?on_conflict=url', { body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
      if (stale.length) await request('DELETE', `/links?url=in.(${quoteList(stale)})`, { prefer: 'return=minimal' });
    },
    upsertLink: async (link) => {
      await request('POST', '/links?on_conflict=url', { body: toRow(link), prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    deleteLink: async (url) => {
      await request('DELETE', `/links?url=eq.${encodeURIComponent(url)}`, { prefer: 'return=minimal' });
    },
    listLinks: async () => (await selectAll('links')).map(fromRow),
    listStatus: async () => (await selectAll('link_status', 'select=*&order=checked.desc')).map(fromStatusRow),
    upsertStatus: async (info) => {
      await request('POST', '/link_status?on_conflict=url', { body: toStatusRow(info), prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    deleteStatus: async (url) => {
      await request('DELETE', `/link_status?url=eq.${encodeURIComponent(url)}`, { prefer: 'return=minimal' });
    },
    upsertIcons: async (rows) => {
      if (!rows.length) return;
      await request('POST', '/icons?on_conflict=host', { body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    listIcons: async () => selectAll('icons', 'select=*'),
  };
};
