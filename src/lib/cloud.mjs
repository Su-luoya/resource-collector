/**
 * 云端行 ↔ 内部资源对象的互相转换，以及 Supabase REST 的最小封装。
 *
 * 内部表示沿用 YAML 时代的样子（section 数组、facets 嵌套、缺省就没有的 note/read），
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
  /** 翻页大小。比 Max Rows 默认值 1000 小一点，服务端截断时也能继续往后走 */
  const PAGE = 500;
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

  /** PostgREST 的 in.(...) / gt.(...) 里带逗号的 URL 必须加双引号，否则会被当成两个值 */
  const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;

  /**
   * 整表读取。Supabase 对每个响应都有行数上限（项目设置 Max Rows，默认 1000），
   * 单请求只能拿到前面一小段——少掉的行会被整表写入当成「库里多出来的」删掉，
   * 所以按主键游标翻页：每页从上一页最后一行的键往后取，服务端截到多短都不会跳行。
   * 只有空页才算读完（短页不算：那可能只是被 Max Rows 截的）。
   */
  const selectAll = async (table, key = 'url') => {
    const rows = [];
    for (;;) {
      const last = rows[rows.length - 1];
      const after = last ? `&${key}=gt.${encodeURIComponent(quote(last[key]))}` : '';
      const page = await request('GET', `/${table}?select=*&order=${key}.asc&limit=${PAGE}${after}`);
      if (!Array.isArray(page) || !page.length) return rows;
      // 服务端要是没按 gt 过滤，就会一直返回同一段：宁可报错，也不能把半张表当成整表
      if (last && page[0][key] === last[key]) throw new Error(`${table} 分页没有前进：${key}=${page[0][key]}`);
      rows.push(...page);
    }
  };

  return {
    /** 一批 upsert：保存时通常只有一行变了，别为一行等三四个往返 */
    upsertLinks: async (links) => {
      if (!links.length) return;
      await request('POST', '/links?on_conflict=url', { body: links.map(toRow), prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    upsertLink: async (link) => {
      await request('POST', '/links?on_conflict=url', { body: toRow(link), prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    deleteLink: async (url) => {
      await request('DELETE', `/links?url=eq.${encodeURIComponent(url)}`, { prefer: 'return=minimal' });
    },
    listLinks: async () => (await selectAll('links')).map(fromRow),
    listStatus: async () => (await selectAll('link_status')).map(fromStatusRow),
    /** 周检一次写一百多条：一个数组请求，别一条一个往返 */
    upsertStatuses: async (infos) => {
      if (!infos.length) return;
      await request('POST', '/link_status?on_conflict=url', {
        body: infos.map(toStatusRow),
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    },
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
    listIcons: async () => selectAll('icons', 'host'),
  };
};
