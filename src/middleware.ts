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
import { execFile, execFileSync } from 'node:child_process';
import { dumpLinks, parseLinks, validateRows, diffRows } from './lib/link-data.mjs';
import { clean, extractMeta, normUrl, sameUrl } from './lib/dev-meta.mjs';

const ROOT = process.cwd();
const DATA_REL = 'src/data/links.yaml';
const ICONS_REL = 'src/data/icons.json';
const ICONS_DIR = 'public/icons';
const TAXONOMY = resolve(ROOT, 'src/data/taxonomy.json');

/** 一条链接的存储形态；字段顺序、引号规则见 src/lib/link-data.mjs */
type FacetValues = Record<string, string | string[]>;
type LinkRow = {
  title: string;
  url: string;
  section: string[];
  facets: Record<string, FacetValues>;
  desc: string;
  added: string;
};

/** 表单传来的 section / facets 只做形状清洗，取值合法性交给 validateRows 统一判定 */
const readFacets = (body: Record<string, unknown>): Record<string, FacetValues> => {
  const out: Record<string, FacetValues> = {};
  if (!body.facets || typeof body.facets !== 'object' || Array.isArray(body.facets)) return out;
  for (const [sid, values] of Object.entries(body.facets as Record<string, unknown>)) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    const one: FacetValues = {};
    for (const [fid, raw] of Object.entries(values as Record<string, unknown>)) {
      if (Array.isArray(raw)) one[fid] = [...new Set(raw.map((v) => String(v)).filter(Boolean))];
      else if (typeof raw === 'string' && raw.trim()) one[fid] = raw.trim();
    }
    out[sid] = one;
  }
  return out;
};

const readSections = (body: Record<string, unknown>): string[] =>
  Array.isArray(body.section) ? [...new Set(body.section.map((v) => String(v)).filter(Boolean))] : [];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const readRows = (): { raw: string; rows: LinkRow[] } => {
  const raw = readFileSync(resolve(ROOT, DATA_REL), 'utf8');
  return { raw, rows: parseLinks(raw) as LinkRow[] };
};

const writeRows = (rows: LinkRow[], raw: string) => {
  const target = resolve(ROOT, DATA_REL);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, dumpLinks(rows, raw), 'utf8');
  renameSync(tmp, target);
};

const taxonomy = () => JSON.parse(readFileSync(TAXONOMY, 'utf8'));

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

/** 异步跑子进程：图标抓取可能要几十秒，同步版本会把整个 dev server 卡住 */
const run = (command: string, args: string[], timeout: number) =>
  new Promise<{ ok: boolean; stdout: string; stderr: string }>((done) => {
    execFile(command, args, { cwd: ROOT, timeout, maxBuffer: 16 << 20 }, (error, stdout, stderr) => {
      done({ ok: !error, stdout: stdout ?? '', stderr: error ? stderr || String(error) : (stderr ?? '') });
    });
  });

const tail = (text: string, lines = 2) => text.trim().split('\n').slice(-lines).join(' ').trim();

/** 当前工作区里这三类数据文件是否有未提交改动 */
const dataDirty = () => gitOr(['status', '--porcelain', '--', DATA_REL, ICONS_REL, ICONS_DIR]) !== '';

/** 与 HEAD 里的 links.yaml 对比，得出待发布的新增/删除/修改条数 */
const pendingDiff = (rows: LinkRow[]) => {
  const prevRaw = gitOr(['show', `HEAD:${DATA_REL}`]);
  if (!prevRaw) return { added: rows.length, removed: 0, changed: 0 };
  return diffRows(parseLinks(prevRaw) as LinkRow[], rows);
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
    const row: LinkRow = {
      title: clean(body.title, 80),
      url,
      section: readSections(body),
      facets: readFacets(body),
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
    const row: LinkRow = {
      title: clean(body.title, 80),
      url: rows[index].url, // url 是主键，不在这里改
      section: readSections(body),
      facets: readFacets(body),
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

const handlePublish = async () => {
  const { rows } = readRows();
  const { errors, warns } = validateRows(rows, taxonomy());
  if (errors.length) {
    return json({ ok: false, message: `校验未通过，已中止发布（${errors.length} 个问题）`, errors }, 400);
  }

  // 补抓新域名的图标：脚本自身幂等，已存在的直接跳过。抓不到不阻断发布，只在结果里说明。
  const icons = await run(process.execPath, ['scripts/fetch-icons.mjs'], 180_000);
  const iconNote = icons.ok ? '' : `图标脚本失败：${tail(icons.stderr) || '未知原因'}`;
  if (iconNote) warns.push(iconNote);

  if (!dataDirty()) {
    return json({
      ok: true,
      nothing: true,
      message: iconNote ? `没有需要发布的数据改动（${iconNote}）` : '没有需要发布的数据改动',
      warns,
    });
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
  const branch = gitOr(['rev-parse', '--abbrev-ref', 'HEAD'], 'master');

  try {
    git(['push', 'origin', branch]);
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

  return json({ ok: true, message: `${message}（${hash}）已推送`, hash, branch, warns });
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

/**
 * 浏览器发的跨站请求一定带 Origin（同源 POST 也带）；没有 Origin 的是 curl / 脚本。
 * 挡住「随便点开一个恶意页面就能往本地 dev server 写盘、甚至 push」这种情况。
 */
const sameOrigin = (origin: string | null, host: string) => {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

export const onRequest = defineMiddleware(async (context, next) => {
  if (!import.meta.env.DEV) return next();

  const path = context.url.pathname;
  const apiAt = path.indexOf('/api/');
  if (apiAt === -1) return next();

  const route = path.slice(apiAt + '/api/'.length).replace(/\/$/, '');
  const method = context.request.method;

  if (method !== 'GET' && !sameOrigin(context.request.headers.get('origin'), context.url.host)) {
    return json({ ok: false, message: '拒绝跨站请求' }, 403);
  }

  if (route === 'meta' && method === 'POST') {
    let target: ReturnType<typeof normUrl>;
    try {
      const body = await context.request.json();
      target = normUrl(body?.url);
    } catch {
      return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
    }
    // 把「只接受 http(s)」「含空白」这类具体原因透给前端，不要一律报成「不能为空」
    if (target.error) return json({ ok: false, message: target.error }, 400);
    return json(await fetchMeta(target.url as string));
  }

  if (route === 'edit' && method === 'POST') return handleEdit(context.request);

  if (route === 'status' && method === 'GET') {
    if (!existsSync(resolve(ROOT, DATA_REL))) return json({ ok: false, message: '找不到 links.yaml' }, 500);
    return handleStatus();
  }

  if (route === 'publish' && method === 'POST') {
    try {
      return await handlePublish();
    } catch (error) {
      return json({ ok: false, message: `发布失败：${gitError(error)}` }, 500);
    }
  }

  return json({ ok: false, message: `未知接口：${route || '空'}` }, 404);
});
