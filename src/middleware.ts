// dev 期编辑端点。
//
// 只在 `npm run dev` 里活着：`import.meta.env.DEV` 在构建时是常量 false，整个分支被摇掉，
// 静态产物里既没有这些路由，也没有任何写文件的能力。
//
// 路由（都挂在站点 base 之下，例如 /resource-collector/api/edit）：
//   POST  api/meta      { url }                        → 抓目标页的 title / description
//   POST  api/edit      { action, ... }                → add | update | delete
//   GET   api/status                                    → 本地数据改动概览
//   POST  api/publish                                   → 抓图标 → 校验 → commit → push
import { defineMiddleware } from 'astro:middleware';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { dumpLinks, parseLinks, validateRows, diffRows } from './lib/link-data.mjs';

const ROOT = process.cwd();
const DATA_REL = 'src/data/links.yaml';
const ICONS_REL = 'src/data/icons.json';
const ICONS_DIR = 'public/icons';
const TAXONOMY = resolve(ROOT, 'src/data/taxonomy.json');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const readRows = () => {
  const raw = readFileSync(resolve(ROOT, DATA_REL), 'utf8');
  return { raw, rows: parseLinks(raw) };
};

const writeRows = (rows: unknown[], raw: string) => {
  const target = resolve(ROOT, DATA_REL);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, dumpLinks(rows, raw), 'utf8');
  renameSync(tmp, target);
};

const taxonomy = () => JSON.parse(readFileSync(TAXONOMY, 'utf8'));

const sameUrl = (a: string, b: string) => a === b || a.replace(/\/$/, '') === b.replace(/\/$/, '');

const normUrl = (input: unknown): { url?: string; error?: string } => {
  let url = String(input ?? '').trim();
  if (!url) return { error: 'URL 不能为空' };
  if (!/^https?:\/\//i.test(url)) {
    const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme) return { error: `只接受 http(s) 链接，收到 ${scheme[1]}:` };
    url = `https://${url}`;
  }
  try {
    new URL(url);
  } catch {
    return { error: `URL 解析失败：${url}` };
  }
  return { url };
};

const clean = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** 从一段 HTML 里取 title 与 description，够用即可：不引 HTML 解析器 */
const extractMeta = (html: string) => {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  let desc = '';
  let source = '';
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    if (!['description', 'og:description', 'twitter:description'].includes(name)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (content.trim()) {
      desc = decodeEntities(content);
      source = name === 'description' ? 'description' : 'og';
      if (name === 'description') break; // 优先 <meta name="description">
    }
  }
  return { title: clean(title, 80), desc: clean(desc, 120), source };
};

const fetchMeta = async (url: string) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, reason: `目标页返回 HTTP ${res.status}` };
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type && !/html|xml/.test(type)) return { ok: false, reason: `不是网页（${type.split(';')[0]}）` };
    const html = (await res.text()).slice(0, 400_000);
    const { title, desc, source } = extractMeta(html);
    if (!title && !desc) return { ok: false, reason: '页面里没找到 <title> 或 description' };
    const notes: string[] = [];
    if (res.url && res.url !== url) notes.push(`会跳转到 ${res.url}，要不要改填这个？`);
    if (source === 'og') notes.push('简介取自 og:description，多为标语，需改写');
    else if (source === 'description') notes.push('简介是站点自述，请确认是否属事实');
    return { ok: true, title, desc, final: res.url, note: notes.join('；') };
  } catch (error) {
    const e = error as { name?: string; message?: string };
    return { ok: false, reason: e?.name === 'AbortError' ? '抓取超时（6 秒）' : `抓取失败：${e?.message ?? e}` };
  } finally {
    clearTimeout(timer);
  }
};

const git = (args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const gitOr = (args: string[], fallback = '') => {
  try {
    return git(args);
  } catch {
    return fallback;
  }
};

const gitError = (error: unknown) => {
  const e = error as { stderr?: string; stdout?: string; message?: string };
  return (e?.stderr || e?.stdout || e?.message || String(error)).trim();
};

/** 当前工作区里这三类数据文件是否有未提交改动 */
const dataDirty = () => gitOr(['status', '--porcelain', '--', DATA_REL, ICONS_REL, ICONS_DIR]) !== '';

/** 与 HEAD 里的 links.yaml 对比，得出待发布的新增/删除/修改条数 */
const pendingDiff = (rows: unknown[]) => {
  const prevRaw = gitOr(['show', `HEAD:${DATA_REL}`]);
  if (!prevRaw) return { added: rows.length, removed: 0, changed: 0 };
  return diffRows(parseLinks(prevRaw), rows as never[]);
};

const handleEdit = async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  }

  const action = String(body.action ?? '');
  const { raw, rows } = readRows();
  const target = normUrl(body.url);
  if (target.error) return json({ ok: false, message: target.error }, 400);
  const url = target.url as string;

  const index = rows.findIndex((r) => sameUrl(String(r.url), url));

  if (action === 'add') {
    if (index >= 0) return json({ ok: false, message: `这条已在库里：${rows[index].url}` }, 409);
    const row = {
      title: clean(body.title, 80),
      url,
      type: clean(body.type, 40),
      topics: Array.isArray(body.topics) ? [...new Set(body.topics.map((t) => String(t)))] : [],
      desc: clean(body.desc, 120),
      added: clean(body.added, 10) || new Date().toISOString().slice(0, 10),
    };
    if (!row.title) return json({ ok: false, message: '标题不能为空' }, 400);
    if (!row.desc) return json({ ok: false, message: '简介不能为空' }, 400);
    const next = [...rows, row];
    const { errors } = validateRows(next, taxonomy());
    if (errors.length) return json({ ok: false, message: '校验未通过', errors }, 400);
    writeRows(next, raw);
    return json({ ok: true, message: `已新增：${row.title}`, total: next.length });
  }

  if (index < 0) return json({ ok: false, message: `库里没有这条：${url}` }, 404);

  if (action === 'delete') {
    const next = rows.filter((_, i) => i !== index);
    writeRows(next, raw);
    return json({ ok: true, message: `已删除：${rows[index].title}`, total: next.length });
  }

  if (action === 'update') {
    const row = {
      title: clean(body.title, 80),
      url: rows[index].url, // url 是主键，不在这里改
      type: clean(body.type, 40),
      topics: Array.isArray(body.topics) ? [...new Set(body.topics.map((t) => String(t)))] : [],
      desc: clean(body.desc, 120),
      added: clean(body.added, 10) || rows[index].added,
    };
    if (!row.title) return json({ ok: false, message: '标题不能为空' }, 400);
    if (!row.desc) return json({ ok: false, message: '简介不能为空' }, 400);
    const next = rows.map((r, i) => (i === index ? row : r));
    const { errors } = validateRows(next, taxonomy());
    if (errors.length) return json({ ok: false, message: '校验未通过', errors }, 400);
    writeRows(next, raw);
    return json({ ok: true, message: `已更新：${row.title}`, total: next.length });
  }

  return json({ ok: false, message: `未知操作：${action || '空'}` }, 400);
};

const handlePublish = () => {
  const { rows } = readRows();
  const { errors, warns } = validateRows(rows, taxonomy());
  if (errors.length) {
    return json({ ok: false, message: `校验未通过，已中止发布（${errors.length} 个问题）`, errors }, 400);
  }

  // 补抓新域名的图标：脚本自身幂等，已存在的直接跳过
  const icons = spawnSync(process.execPath, ['scripts/fetch-icons.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const iconTail = (icons.stdout || '').trim().split('\n').slice(-1)[0] ?? '';

  if (!dataDirty()) {
    return json({ ok: true, nothing: true, message: '没有需要发布的数据改动', warns });
  }

  const { added, removed, changed } = pendingDiff(rows);
  const parts = [
    added ? `新增 ${added} 条` : '',
    removed ? `删除 ${removed} 条` : '',
    changed ? `修改 ${changed} 条` : '',
  ].filter(Boolean);
  const message = parts.length ? `data: ${parts.join('、')}` : 'data: 更新图标';

  const paths = [DATA_REL, ICONS_REL, ICONS_DIR];
  try {
    git(['add', '--', ...paths]);
    // 带路径提交：只提交数据文件，工作区里其它改动留在原处
    git(['commit', '-m', message, '--', ...paths]);
  } catch (error) {
    return json({ ok: false, message: `提交失败：${gitError(error)}` }, 500);
  }

  const hash = gitOr(['rev-parse', '--short', 'HEAD']);

  try {
    git(['push', 'origin', 'master']);
  } catch (error) {
    const detail = gitError(error);
    const rejected = /rejected|non-fast-forward|fetch first/i.test(detail);
    return json(
      {
        ok: false,
        pushed: false,
        hash,
        message: rejected
          ? `本地已提交 ${hash}，但远端有新提交，push 被拒。先在终端跑 git pull --rebase 再发布。`
          : `本地已提交 ${hash}，但 push 失败：${detail}`,
      },
      502,
    );
  }

  return json({ ok: true, message: `${message}（${hash}）已推送`, hash, iconTail, warns });
};

const handleStatus = () => {
  const { rows } = readRows();
  const { added, removed, changed } = pendingDiff(rows);
  const dirty = added + removed + changed > 0 || dataDirty();
  return json({
    ok: true,
    dirty,
    added,
    removed,
    changed,
    branch: gitOr(['rev-parse', '--abbrev-ref', 'HEAD'], '?'),
    head: gitOr(['rev-parse', '--short', 'HEAD'], '?'),
  });
};

export const onRequest = defineMiddleware(async (context, next) => {
  if (!import.meta.env.DEV) return next();

  const path = context.url.pathname;
  const apiAt = path.indexOf('/api/');
  if (apiAt === -1) return next();

  const route = path.slice(apiAt + '/api/'.length).replace(/\/$/, '');
  const method = context.request.method;

  if (route === 'meta' && method === 'POST') {
    let url: string | undefined;
    try {
      const body = await context.request.json();
      url = normUrl(body?.url).url;
    } catch {
      return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
    }
    if (!url) return json({ ok: false, message: 'URL 不能为空' }, 400);
    return json(await fetchMeta(url));
  }

  if (route === 'edit' && method === 'POST') return handleEdit(context.request);

  if (route === 'status' && method === 'GET') {
    if (!existsSync(resolve(ROOT, DATA_REL))) return json({ ok: false, message: '找不到 links.yaml' }, 500);
    return handleStatus();
  }

  if (route === 'publish' && method === 'POST') {
    try {
      return handlePublish();
    } catch (error) {
      return json({ ok: false, message: `发布失败：${gitError(error)}` }, 500);
    }
  }

  return json({ ok: false, message: `未知接口：${route || '空'}` }, 404);
});
