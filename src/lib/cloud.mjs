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

/**
 * 每行的键必须完全一致：PostgREST 批量插入（POST 数组）在键不齐时整批拒绝
 * （PGRST102 "All object keys must match"），一条 ok 混一条 redirect 就会全军覆没，
 * 而且不报是哪条的问题。所以缺的字段显式写 null——合并写入时也正好把旧值清掉
 * （本来 redirect 的 target，重定向修好后不该留着）。
 */
export const toStatusRow = (info) => ({
  url: info.url,
  status: info.status,
  checked: info.checked,
  code: Number.isFinite(info.code) ? info.code : null,
  target: info.final || null,
  error: info.error || null,
});

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
  /** 超过这么多行还读不完，就当分页没生效，直接报错而不是一直转 */
  const MAX_ROWS = 20000;
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

  /**
   * 整表读取。按主键排序、用 limit/offset 翻页，直到某一页为空才停。
   *
   * 不用 `gt."上一个主键"` 当游标：Supabase 前面那层会把带 URL 的过滤参数吃掉，
   * 原样返回整张表（实测），循环就永远结束不了。
   * 也不能「取回不足一页就当读完」：项目设了 Max Rows 时服务端会少给几行，那样会悄悄截断，
   * 截掉的最后一行会在整表写入时被当成「库里多出来的」删掉。所以只认空页。
   */
  const selectAll = async (table, key = 'url') => {
    const rows = [];
    for (;;) {
      const page = await request('GET', `/${table}?select=*&order=${key}.asc&limit=${PAGE}&offset=${rows.length}`);
      if (!Array.isArray(page)) throw new Error(`${table} 读取失败：预期返回数组`);
      if (!page.length) return rows;
      rows.push(...page);
      // 服务端要是连 offset 也不认，rows 会一直涨：宁可报错，也不能把半张表当成整表
      if (rows.length > MAX_ROWS) throw new Error(`${table} 分页没有前进，已取到 ${rows.length} 行`);
    }
  };

  return {
    // 新增不用 upsert：缓存看不到的云端新行不能被覆盖。
    insertLinks: async (links) => {
      if (!links.length) return;
      await request('POST', '/links', { body: links.map(toRow), prefer: 'return=minimal' });
    },
    updateLink: async (url, patch) => {
      const updated = await request('PATCH', `/links?url=eq.${encodeURIComponent(url)}&select=url`, { body: patch, prefer: 'return=representation' });
      if (updated?.length !== 1) throw new Error(`没有更新到原记录：${url}`);
    },
    deleteLink: async (url) => {
      const deleted = await request('DELETE', `/links?url=eq.${encodeURIComponent(url)}&select=url`, { prefer: 'return=representation' });
      if (deleted?.length !== 1) throw new Error(`没有删除到原记录：${url}`);
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
    /** 清理已经不在数据里的域名：批量删，一次请求；hostKey 保证值里只有 [a-z0-9.-]，引号只是兜底 */
    deleteIcons: async (hosts) => {
      if (!hosts.length) return;
      const list = hosts.map((host) => `"${String(host).replace(/"/g, '')}"`).join(',');
      await request('DELETE', `/icons?host=in.(${encodeURIComponent(list)})`, { prefer: 'return=minimal' });
    },
    listIcons: async () => selectAll('icons', 'host'),
  };
};
