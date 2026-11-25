// 链接探测、永久重定向修复与本地维护待办的共用实现。
// scripts/check-links.mjs 与 src/middleware.ts 都从这里取规则，避免周检和单条复查判定漂移。
import { urlKey } from './link-data.mjs';

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const PERMANENT_CODES = new Set([301, 308]);
const GET_FALLBACK_CODES = new Set([400, 403, 405, 501]);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; en-US) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const classifyLink = (status, error) => {
  if (error) return /ENOTFOUND|EAI_AGAIN|CERT|SSL/i.test(String(error)) ? 'fail' : 'warn';
  if (status >= 200 && status < 400) return 'ok';
  if ([401, 403, 405, 429].includes(status)) return 'warn';
  return 'fail';
};

const errorCode = (error) =>
  error?.cause?.code || error?.name || String(error);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 只重试「可能是抖动」的结果：5xx、429、超时与连接重置；404/403/域名不存在不重试 */
export const transientFailure = (info) => {
  if (info.error) return !/ENOTFOUND|EAI_AGAIN|CERT|SSL/i.test(info.error);
  return info.code >= 500 || info.code === 429;
};

/**
 * 手动跟随每一次重定向，才能知道链上究竟是 301/308 还是临时跳转。
 * 返回形态与 link-status.json 的单条记录一致，但 checked 由调用方补上。
 */
export const probeLink = async (url, options = {}) => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeout = options.timeout ?? 12_000;
  const maxRedirects = options.maxRedirects ?? 10;
  const retries = options.retries ?? 1;
  const retryDelay = options.retryDelay ?? 1_200;
  const token = options.token ?? process.env.GITHUB_TOKEN;

  const attempt = async (initialMethod) => {
    let method = initialMethod;
    let current = url;
    const redirects = [];

    for (;;) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      let res;
      try {
        const headers = { 'user-agent': UA, accept: 'text/html,*/*' };
        // 手动转发 headers 时必须逐跳判断，不能把 GitHub token 带给重定向后的其它主机。
        if (/^https:\/\/api\.github\.com\//.test(current) && token) {
          headers.authorization = `Bearer ${token}`;
        }
        res = await fetchImpl(current, {
          method,
          headers,
          redirect: 'manual',
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const code = res.status;
      const location = res.headers.get('location');
      if (res.body) await res.body.cancel();

      if (REDIRECT_CODES.has(code) && location) {
        if (redirects.length >= maxRedirects) {
          return {
            status: 'warn',
            code,
            error: `重定向超过 ${maxRedirects} 次`,
            ...(current !== url ? { final: current } : {}),
            redirects,
          };
        }
        redirects.push(code);
        current = new URL(location, current).href;
        if (code === 303) method = 'GET';
        continue;
      }

      // 与旧体检一致：部分站点不支持 HEAD，最终响应拒绝 HEAD 时从原 URL 用 GET 重试。
      if (method === 'HEAD' && GET_FALLBACK_CODES.has(code)) return attempt('GET');

      const classified = classifyLink(code);
      return {
        status: redirects.length && code >= 200 && code < 300 ? 'redirect' : classified,
        code,
        ...(current !== url ? { final: current } : {}),
        ...(redirects.length ? { redirects } : {}),
      };
    }
  };

  const run = async () => {
    try {
      return await attempt('HEAD');
    } catch (error) {
      const code = errorCode(error);
      return { status: classifyLink(0, code), error: code };
    }
  };

  let result = await run();
  for (let i = 0; i < retries && transientFailure(result); i++) {
    if (retryDelay) await sleep(retryDelay);
    result = await run();
  }
  return result;
};

export const datedStatus = (info, checked = new Date().toISOString().slice(0, 10)) => ({
  ...info,
  checked,
});

/**
 * 两次确认才算真坏：404/410 是确定性的，立即判 fail；5xx、429、超时这类可能只是抖动，
 * 上一轮也没通过（或从没检查过）时先降为 warn，下一轮还是失败才写成 fail。
 */
export const confirmFailure = (info, previous) => {
  if (info.status !== 'fail') return info;
  if (info.code === 404 || info.code === 410) return info;
  if (previous?.status === 'fail' || previous?.status === 'warn') return info;
  return { ...info, status: 'warn' };
};

/** 只有简报约定的「同主机、纯 301/308 链、最终 HTTPS 2xx、无重复」允许自动修。 */
export const redirectFixDecision = (original, info, rows) => {
  const no = (reason) => ({ eligible: false, reason });
  if (!info?.final || info.final === original) return no('没有可用的新地址');
  if (!(info.code >= 200 && info.code < 300)) return no(`跳转目标返回 HTTP ${info.code ?? '未知'}`);

  const chain = info.redirects ?? [];
  if (!chain.length || !chain.every((code) => PERMANENT_CODES.has(code))) {
    return no('包含临时重定向，需人工确认');
  }

  const from = URL.parse(original);
  const to = URL.parse(info.final);
  if (!from || !to) return no('重定向地址无法解析');
  if (to.protocol !== 'https:') return no('最终地址不是 HTTPS');
  if (from.hostname.toLowerCase() !== to.hostname.toLowerCase()) return no('重定向跨主机，需人工确认');

  const targetKey = urlKey(info.final);
  const duplicate = rows.find(
    (row) => urlKey(row.url) !== urlKey(original) && urlKey(row.url) === targetKey,
  );
  if (duplicate) return no(`新地址已由「${duplicate.title}」使用，需人工合并`);

  return { eligible: true, reason: '同主机永久重定向' };
};

/**
 * 对一轮体检结果应用自动修复，并同时把状态表的 key 迁到新 URL。
 * 顺序占用目标地址，两个旧链接同时跳向同一新地址时，后一个会转人工而不会制造重复。
 */
export const applyRedirectFixes = (rows, results, checked) => {
  const next = [...rows];
  const statuses = {};
  const fixes = [];

  rows.forEach((row, index) => {
    const result = results[row.url];
    if (!result) return;
    const info = datedStatus(result, checked);
    const decision = redirectFixDecision(row.url, info, next);

    if (decision.eligible) {
      const from = row.url;
      const to = info.final;
      next[index] = { ...row, url: to };
      const { final: _final, redirects: _redirects, ...rest } = info;
      statuses[to] = { ...rest, status: 'ok', fixedFrom: from };
      fixes.push({ title: row.title, from, to });
    } else {
      statuses[row.url] = info;
    }
  });

  return { rows: next, statuses, fixes };
};

/** 本地 dev 面板只列 fail 与需要处理的 redirect；warn 仍只保留卡片角标。 */
export const maintenanceTasks = (rows, statuses) => {
  const tasks = [];
  for (const row of rows) {
    const info = statuses[row.url];
    if (!info) continue;

    if (info.status === 'fail') {
      tasks.push({
        kind: 'fail',
        reason: info.error ? `探测失败：${info.error}` : `目标返回 HTTP ${info.code ?? '未知'}`,
        row,
        status: info,
      });
      continue;
    }

    if (info.status === 'redirect' && info.final && info.final !== row.url) {
      const decision = redirectFixDecision(row.url, info, rows);
      tasks.push({ kind: 'redirect', reason: decision.reason, row, status: info });
    }
  }

  return tasks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'fail' ? -1 : 1));
};
