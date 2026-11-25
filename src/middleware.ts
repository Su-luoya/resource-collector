// dev 期编辑端点。
//
// 只在 `npm run dev` 里活着：`import.meta.env.DEV` 在构建时是常量 false，整个分支被摇掉，
// 静态产物里既没有这些路由，也没有任何写文件的能力。
//
// 路由（都挂在站点 base 之下，例如 /resource-collector/api/edit）：
//   POST  api/meta      { url }                        → 抓目标页的 title / description
//   POST  api/ai-draft  { url, current, overwrite }     → 本机 pi 依页面正文生成标题/简介/分区分类
//   POST  api/edit      { action, ... }                → add | update | delete
//   POST  api/batch-meta { urls }                      → 批量抓取草稿，不写文件
//   POST  api/batch-add { rows }                       → 校验后一次写入整批资源
//   POST  api/import-bookmarks { html, commit }        → 浏览器书签文件：先出草稿，确认后一次写入
//   POST  api/duplicates { url, title, excludeUrl }     → 相似候选与跟踪参数清理建议
//   GET   api/duplicates-scan                           → 全库查重：同 URL / 清参数后相同 / 同站点同名
//   GET   api/status                                    → 数据改动与分支推送状态
//   GET   api/publish-preview                           → 发布前的结构化数据差异
//   GET   api/maintenance                               → fail 与待人工处理的 redirect
//   POST  api/recheck   { url }                         → 单条复查并更新体检状态
//   POST  api/publish                                   → 启动发布任务，立即返回 { id }
//   POST  api/batch-meta { urls }                      → 启动批量抓取任务，立即返回 { id }
//   GET   api/task?id=…                                 → 任务进度快照；不带 id 时只列正在跑的任务
import { defineMiddleware } from 'astro:middleware';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { validateRows, diffRows, diffRowDetails, urlKey } from './lib/link-data.mjs';
import { clean, extractMeta, htmlToText, normUrl } from './lib/dev-meta.mjs';
import { buildPrompt, mergeDraft, parseDraft } from './lib/ai-draft.mjs';
import { datedStatus, maintenanceTasks, probeLink } from './lib/link-maintenance.mjs';
import { cleanupUrl, findDuplicateCandidates, scanDuplicates } from './lib/link-quality.mjs';
import { suggestFor } from './lib/link-rules.mjs';
import { parseBookmarks, tidyTitle } from './lib/bookmarks-html.mjs';
import { createTaskStore } from './lib/dev-task.mjs';
import { clientFor, refreshCache } from './lib/cloud-sync.mjs';
import type { LinkStatus, Resource } from './lib/links';

const ROOT = process.cwd();
const CACHE_REL = '.cache/links.json';
const PUBLISHED_REL = '.cache/published.json';
const ICONS_DIR = 'public/icons';
const TAXONOMY = resolve(ROOT, 'src/data/taxonomy.json');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * 库是唯一事实源。dev 进程里留一份内存镜像，省掉每次请求都拉全表；
 * 写入一律先写库，成功后再刷新镜像与 `.cache/links.json`，失败就什么都不改。
 */
const store: { rows: Resource[]; statuses: Record<string, LinkStatus>; loaded: boolean } = {
  rows: [],
  statuses: {},
  loaded: false,
};

const loadStore = () => {
  if (store.loaded) return store;
  try {
    const cache = JSON.parse(readFileSync(resolve(ROOT, CACHE_REL), 'utf8'));
    store.rows = (cache.links ?? []) as Resource[];
    store.statuses = (cache.status ?? {}) as Record<string, LinkStatus>;
    store.loaded = true;
  } catch {
    throw new Error('没有 .cache/links.json：先跑 npm run sync 从云端拉一次数据');
  }
  return store;
};

const readRows = (): Resource[] => loadStore().rows;

const readStatuses = (): Record<string, LinkStatus> => loadStore().statuses;

/** 写库统一入口：先校验，再整表对齐，最后刷新缓存与镜像 */
const applyEdit = async (nextRows: unknown[], message: string, sync?: { from: string; to?: string }) => {
  const rows = nextRows as Resource[];
  const { errors } = validateRows(rows, taxonomy());
  if (errors.length) return json({ ok: false, message: '校验未通过', errors }, 400);
  const client = clientFor({ write: true });
  try {
    await client.replaceLinks(rows);
    if (sync && sync.from !== sync.to) {
      const previous = store.statuses[sync.from];
      await client.deleteStatus(sync.from);
      delete store.statuses[sync.from];
      if (sync.to) {
        delete store.statuses[sync.to];
        if (previous && urlKey(sync.from) === urlKey(sync.to)) {
          store.statuses[sync.to] = previous;
          await client.upsertStatus({ ...previous, url: sync.to });
        }
      }
    }
  } catch (error) {
    return json({ ok: false, message: `写库失败：${(error as Error).message}` }, 502);
  }
  store.rows = rows;
  await refreshCache(client);
  return json({ ok: true, message, total: rows.length });
};

const taxonomy = () => JSON.parse(readFileSync(TAXONOMY, 'utf8'));

/** 抓一个网页的 HTML：api/meta 与 api/ai-draft 共用，失败原因统一透给前端 */
const fetchPage = async (url: string) => {
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
    return { ok: true, html: (await res.text()).slice(0, 400_000), final: res.url };
  } catch (error) {
    const e = error as { name?: string; message?: string };
    return { ok: false, reason: e?.name === 'AbortError' ? '抓取超时（6 秒）' : `抓取失败：${e?.message ?? e}` };
  } finally {
    clearTimeout(timer);
  }
};

const fetchMeta = async (url: string) => {
  const page = await fetchPage(url);
  if (!page.ok) return { ok: false, reason: page.reason };
  const html = page.html ?? '';
  const { title, desc, source } = extractMeta(html);
  if (!title && !desc) return { ok: false, reason: '页面里没找到 <title> 或 description' };
  const notes: string[] = [];
  if (page.final && page.final !== url) notes.push(`会跳转到 ${page.final}，要不要改填这个？`);
  if (source === 'og') notes.push('简介取自 og:description，多为标语，需改写');
  else if (source === 'description') notes.push('简介是站点自述，请确认是否属事实');
  return { ok: true, title, desc, final: page.final, note: notes.join('；') };
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

/** 异步跑子进程：图标抓取可能要几十秒，同步版本会把整个 dev server 卡住。
 *  同时把 stdout 逐行回调出去，发布进度条的「3/24」就是从这些行里数出来的。 */
const spawnLines = (
  command: string,
  args: string[],
  { timeout = 180_000, onLine }: { timeout?: number; onLine?: (line: string) => void } = {},
) =>
  new Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }>((done) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      done({ ok: false, stdout: '', stderr: gitError(error), timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) onLine?.(line);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ ok: false, stdout, stderr: stderr || gitError(error), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pending) onLine?.(pending);
      done({ ok: code === 0, stdout, stderr, timedOut });
    });
  });

const tail = (text: string, lines = 2) => text.trim().split('\n').slice(-lines).join(' ').trim();

/** dev 期的长任务（发布、批量抓取）登记在这里，前端按 id 轮询 */
const tasks = createTaskStore();

const PUBLISH_STEPS = [
  { id: 'sync', label: '从云端拉最新数据' },
  { id: 'icons', label: '补抓缺失图标' },
  { id: 'dispatch', label: '触发 GitHub Actions 重建' },
];

const BATCH_STEPS = [{ id: 'fetch', label: '抓取页面标题与简介' }];

/**
 * 「上次发布」的快照：每次触发重建时把当前数据写进 .cache/published.json。
 * 用它与现数据对比，得出待发布的新增/删除/修改；不再依赖 git HEAD（库已经是事实源）。
 * status 存的是同一时刻的链接体检状态，用来判断这次重建会带上新的体检结果。
 */
type PublishedSnapshot = { links: Resource[]; status: Record<string, LinkStatus> };

const readPublishedSnapshot = (): PublishedSnapshot => {
  try {
    const raw = JSON.parse(readFileSync(resolve(ROOT, PUBLISHED_REL), 'utf8'));
    return { links: (raw.links ?? []) as Resource[], status: (raw.status ?? {}) as Record<string, LinkStatus> };
  } catch {
    return { links: [], status: {} };
  }
};

const readPublished = (): Resource[] => readPublishedSnapshot().links;

const writePublished = (rows: Resource[], status: Record<string, LinkStatus>) => {
  const target = resolve(ROOT, PUBLISHED_REL);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ publishedAt: new Date().toISOString(), links: rows, status }, null, 2)}\n`);
};

/** 与上次发布对比，得出待发布的新增/删除/修改条数 */
const pendingDiff = (rows: Resource[]) => diffRows(readPublished(), rows);

const hasPending = (rows: Resource[]) => {
  const { added, removed, changed } = pendingDiff(rows);
  return added + removed + changed > 0;
};

const handlePublishPreview = () => {
  const rows = readRows();
  const published = readPublishedSnapshot();
  const statuses = readStatuses();
  // 只比两次快照都有的地址：上次发布后新收的行本来就没有旧状态。
  const statusChanged = Object.keys(published.status).some(
    (url) => JSON.stringify(published.status[url]) !== JSON.stringify(statuses[url]),
  );
  // 图标现在由 CI 在构建时抓（只进产物，不回写仓库），所以没有「图标文件待提交」这回事。
  return json({ ok: true, ...diffRowDetails(published.links, rows), statusChanged, icons: [] });
};

const handleDuplicates = async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  }
  const target = normUrl(body?.url);
  if (!target.url) return json({ ok: false, message: target.error }, 400);
  // 只有编辑（或维护里改 URL）才排除自身；新增时必须把完全重复的那条报出来。
  const excluded = body?.excludeUrl ? normUrl(body.excludeUrl) : null;
  if (excluded && !excluded.url) return json({ ok: false, message: excluded.error }, 400);
  const rows = readRows();
  return json({
    ok: true,
    cleanup: cleanupUrl(target.url),
    candidates: findDuplicateCandidates({
      url: target.url,
      title: clean(body?.title, 80),
      excludeUrl: excluded?.url ?? '',
      rows,
    }),
  });
};

const BATCH_LIMIT = 20;

/** 全库查重：只读，不动数据。报出来的每组都要用户自己决定怎么处理。 */
const handleDuplicatesScan = () => {
  const rows = readRows();
  return json({ ok: true, ...scanDuplicates(rows) });
};

// AI 生成：只在本机 dev 里跑，固定调用 PATH 上的 pi（或 PI_BIN 指定的二进制），不开工具与 session。
const AI_TEXT_LIMIT = 6000;
const AI_TIMEOUT = 45_000;

const runPi = (prompt: string) =>
  new Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }>((done) => {
    let child: ReturnType<typeof spawn>;
    try {
      // stdin 必须给 /dev/null：execFile 的管道会让 `pi -p` 等到 EOF，实测卡到超时
      child = spawn(
        process.env.PI_BIN || 'pi',
        [
          '-p',
          '--no-session',
          '--no-tools',
          '--no-context-files',
          '--no-mcp',
          '--no-extensions',
          '--no-skills',
          '--no-prompt-templates',
          '--mode',
          'text',
          prompt,
        ],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      done({ ok: false, stdout: '', stderr: gitError(error), timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, AI_TIMEOUT);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ ok: false, stdout, stderr: stderr || gitError(error), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, stdout, stderr, timedOut });
    });
  });

/**
 * 填一个 URL 就由模型写元信息。只把抓到的页面正文交给模型，不写盘；
 * 输出先过词表过滤与正文比对，再与表单已有内容合并（默认不覆盖已填内容）。
 */
const handleAiDraft = async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  }
  const target = normUrl(body?.url);
  if (!target.url) return json({ ok: false, message: target.error }, 400);

  const page = await fetchPage(target.url);
  if (!page.ok) return json({ ok: false, message: page.reason }, 422);
  const html = page.html ?? '';
  const text = htmlToText(html, AI_TEXT_LIMIT);
  if (text.length < 200) {
    return json({ ok: false, message: '页面正文太少（多半是纯 JS 渲染站），没法只依据正文生成' }, 422);
  }

  const started = Date.now();
  const result = await runPi(
    buildPrompt({ url: target.url, pageTitle: extractMeta(html).title, text, taxonomy: taxonomy() }),
  );
  if (!result.ok) {
    const reason = result.timedOut ? `调用 pi 超时（${AI_TIMEOUT / 1000} 秒）` : `调用 pi 失败：${tail(result.stderr, 3) || '返回非零'}`;
    return json({ ok: false, message: reason }, 502);
  }

  const parsed = parseDraft(result.stdout, taxonomy(), text);
  if (!parsed.ok || !parsed.draft) {
    return json(
      { ok: false, message: parsed.reason ?? '模型没给出可用的元信息', raw: result.stdout.slice(0, 400) },
      422,
    );
  }

  const merged = mergeDraft(body?.current, parsed.draft, { overwrite: body?.overwrite === true });
  return json({
    ok: true,
    merged,
    kept: merged.kept,
    warnings: parsed.warnings,
    evidence: parsed.draft.evidence,
    unverified: parsed.unverified,
    final: page.final,
    ms: Date.now() - started,
  });
};

const handleBatchMeta = async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  }
  const input = Array.isArray(body?.urls) ? body.urls : [];
  if (!input.length) return json({ ok: false, message: '请至少提供一个 URL' }, 400);
  if (input.length > BATCH_LIMIT) return json({ ok: false, message: `每批最多 ${BATCH_LIMIT} 条` }, 400);

  const rows = readRows();
  const seen = new Set<string>();
  const pending: string[] = [];
  const skipped: { url: string; reason: string; row?: Resource }[] = [];
  for (const item of input) {
    const target = normUrl(item);
    const value = target.url;
    if (!value) {
      skipped.push({ url: String(item), reason: target.error ?? 'URL 无效' });
      continue;
    }
    const key = urlKey(value);
    if (!key) {
      skipped.push({ url: String(item), reason: target.error ?? 'URL 无效' });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ url: value, reason: '本批重复' });
      continue;
    }
    seen.add(key);
    const existing = rows.find((row) => urlKey(row.url) === key);
    if (existing) {
      skipped.push({ url: value, reason: '库中已存在', row: existing });
      continue;
    }
    pending.push(value);
  }

  const task = tasks.start('batch-meta', BATCH_STEPS);
  void runBatchMetaTask(task.id, pending, skipped);
  return json({ ok: true, id: task.id }, 202);
};

/** 并发 4 抓页面；每完成一条就推进「x/y」并记一行日志，前端轮询就能看到进展 */
const runBatchMetaTask = async (
  id: string,
  pending: string[],
  skipped: { url: string; reason: string; row?: Resource }[],
) => {
  try {
    tasks.mark(id, 'fetch', 'running', `0/${pending.length}`);
    tasks.progress(id, 0, pending.length);
    const drafts: unknown[] = new Array(pending.length);
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const index = cursor++;
        const url = pending[index];
        const meta = await fetchMeta(url);
        drafts[index] = {
          title: clean('title' in meta ? meta.title : '', 80),
          url,
          section: [],
          facets: {},
          desc: clean('desc' in meta ? meta.desc : '', 120),
          added: new Date().toISOString().slice(0, 10),
          note: 'note' in meta ? meta.note : 'reason' in meta ? meta.reason : '',
        };
        done++;
        tasks.progress(id, done, pending.length);
        tasks.mark(id, 'fetch', 'running', `${done}/${pending.length}`);
        tasks.detail(id, meta.ok ? `✓ ${url}` : `✗ ${url}（${'reason' in meta ? meta.reason : '抓不到'}）`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
    const filled = (drafts as { title: string }[]).filter((draft) => draft.title).length;
    tasks.mark(id, 'fetch', 'ok', `${filled}/${pending.length} 条拿到标题`);
    tasks.complete(id, {
      message: `已抓取 ${pending.length} 条（${filled} 条拿到标题），另外 ${skipped.length} 条被跳过`,
      result: { ok: true, drafts, skipped },
    });
  } catch (error) {
    const message = `批量抓取失败：${gitError(error)}`;
    tasks.fail(id, { message, result: { ok: false, message } });
  }
};

const handleBatchAdd = async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  }
  const input = Array.isArray(body?.rows) ? body.rows : [];
  if (!input.length) return json({ ok: false, message: '没有待写入的草稿' }, 400);
  if (input.length > BATCH_LIMIT) return json({ ok: false, message: `每批最多 ${BATCH_LIMIT} 条` }, 400);

  const rows = readRows();
  const occupied = new Set(rows.map((row) => urlKey(row.url)));
  const prepared = [];
  for (let index = 0; index < input.length; index++) {
    const item = input[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return json({ ok: false, message: `第 ${index + 1} 条草稿不是对象` }, 400);
    }
    const target = normUrl((item as Record<string, unknown>).url);
    if (!target.url) return json({ ok: false, message: `第 ${index + 1} 条：${target.error}` }, 400);
    const key = urlKey(target.url);
    if (occupied.has(key)) return json({ ok: false, message: `第 ${index + 1} 条已在库中或与本批重复：${target.url}` }, 409);
    const source = item as Record<string, unknown>;
    const row = {
      title: clean(source.title, 80),
      url: target.url,
      section: source.section ?? [],
      facets: source.facets ?? {},
      desc: clean(source.desc, 120),
      added: source.added || new Date().toISOString().slice(0, 10),
    };
    if (!row.title) return json({ ok: false, message: `第 ${index + 1} 条标题不能为空` }, 400);
    if (!row.desc) return json({ ok: false, message: `第 ${index + 1} 条简介不能为空` }, 400);
    occupied.add(key);
    prepared.push(row);
  }
  if (body?.dryRun === true) {
    const { errors } = validateRows([...rows, ...prepared], taxonomy());
    if (errors.length) return json({ ok: false, message: '草稿校验未通过', errors }, 400);
    return json({ ok: true, message: '草稿有效' });
  }
  return applyEdit([...rows, ...prepared], `已批量新增 ${prepared.length} 条资源`);
};

/** 书签导入：书签里没有简介，占位文案写实情，导入后一概记为「待看」 */
const IMPORT_DESC = '待补：从书签导入，简介还没写';

const handleImportBookmarks = async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  }
  const html = typeof body?.html === 'string' ? body.html : '';
  if (!html) return json({ ok: false, message: '没读到书签文件内容' }, 400);
  if (html.length > 8_000_000) return json({ ok: false, message: '书签文件太大（上限 8 MB）' }, 413);

  const parsed = parseBookmarks(html);
  if (!parsed.items.length) {
    return json({ ok: false, message: '文件里没找到链接，最好选浏览器导出的「书签 HTML」' }, 422);
  }

  if (body?.commit === true) {
    const input = Array.isArray(body?.rows) ? body.rows : [];
    if (!input.length) return json({ ok: false, message: '没有待导入的条目' }, 400);
    const rows = readRows();
    const occupied = new Set(rows.map((row) => urlKey(row.url)));
    const prepared = [];
    const missing = [];
    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      const source = item as Record<string, unknown>;
      const target = normUrl(source.url);
      if (!target.url) continue;
      const key = urlKey(target.url);
      if (occupied.has(key)) continue;
      const section = Array.isArray(source.section) ? source.section : [];
      if (!section.length) {
        missing.push(target.url);
        continue;
      }
      occupied.add(key);
      prepared.push({
        title: clean(source.title, 80) || tidyTitle('', target.url),
        url: target.url,
        section,
        facets: source.facets && typeof source.facets === 'object' ? source.facets : {},
        desc: clean(source.desc, 120) || IMPORT_DESC,
        added: source.added || new Date().toISOString().slice(0, 10),
        read: false,
      });
    }
    if (missing.length) {
      return json({ ok: false, message: `还有 ${missing.length} 条没选分区`, missing }, 400);
    }
    if (!prepared.length) return json({ ok: false, message: '这些条目都已存在，没新增' }, 409);
    return applyEdit([...rows, ...prepared], `已导入 ${prepared.length} 条（都标为待看）`);
  }

  const rows = readRows();
  const occupied = new Set(rows.map((row) => urlKey(row.url)));
  const skipped: { url: string; reason: string }[] = [];
  const drafts = [];
  for (const item of parsed.items) {
    const key = urlKey(item.url);
    if (!key) {
      skipped.push({ url: item.url, reason: 'URL 无效' });
      continue;
    }
    if (occupied.has(key)) {
      skipped.push({ url: item.url, reason: '库里已有' });
      continue;
    }
    occupied.add(key);
    const rule = suggestFor(item.url, taxonomy());
    drafts.push({
      title: tidyTitle(item.title, item.url),
      url: item.url,
      section: rule?.section ?? [],
      facets: rule?.facets ?? {},
      desc: IMPORT_DESC,
      added: new Date().toISOString().slice(0, 10),
      folder: item.folder,
      guessed: Boolean(rule),
    });
  }
  return json({ ok: true, drafts, skipped, total: parsed.total });
};

const handleEdit = async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, message: '请求体必须是 JSON 对象' }, 400);
  }
  const action = body.action;
  if (action !== 'add' && action !== 'update' && action !== 'delete') {
    return json({ ok: false, message: '未知操作，只接受 add / update / delete' }, 400);
  }
  const target = normUrl(body.url);
  if (!target.url) return json({ ok: false, message: target.error }, 400);

  const rows = readRows();
  const key = urlKey(target.url);
  const index = rows.findIndex((r) => r && urlKey(r.url) === key);
  const previous = rows[index];
  if (action === 'add' && previous) return json({ ok: false, message: `这条已在库里：${previous.url}` }, 409);
  if (action !== 'add' && !previous) return json({ ok: false, message: `库里没有这条：${target.url}` }, 404);
  if (action === 'delete') {
    const response = await applyEdit(rows.filter((_, i) => i !== index), `已删除：${previous.title}`, { from: previous.url });
    return response;
  }

  const replacement = action === 'update' && body.newUrl !== undefined ? normUrl(body.newUrl) : target;
  if (!replacement.url) return json({ ok: false, message: replacement.error }, 400);
  const replacementKey = urlKey(replacement.url);
  if (
    action === 'update' &&
    replacementKey !== key &&
    rows.some((r, i) => i !== index && urlKey(r.url) === replacementKey)
  ) {
    return json({ ok: false, message: '新 URL 已由另一条资源使用' }, 409);
  }

  const row = {
    ...previous,
    title: body.title === undefined ? previous?.title : clean(body.title, 80),
    url: replacement.url,
    section: body.section ?? previous?.section,
    facets: body.facets ?? previous?.facets,
    desc: body.desc === undefined ? previous?.desc : clean(body.desc, 120),
    added: body.added == null || body.added === '' ? previous?.added ?? new Date().toISOString().slice(0, 10) : body.added,
    // 置顶：只有显式传 pin 时才改，没传就沿用旧值（星标、编辑、撤销都靠这一条）
    ...(body.pin === undefined ? {} : { pin: body.pin === true }),
    // 笔记同理：没传就沿用；传了空字符串就是删掉这篇笔记
    ...(body.note === undefined ? {} : typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : { note: undefined }),
    // 待看只在 false 时落盘：数据里没这个字段就是「已看过」，不写 read: true
    ...(body.read === undefined ? {} : { read: body.read === false ? false : undefined }),
  };
  if (row.note === undefined) delete (row as { note?: unknown }).note;
  if (row.read === undefined) delete (row as { read?: unknown }).read;
  if (row.pin === false) delete (row as { pin?: unknown }).pin;
  if (!row.title) return json({ ok: false, message: '标题不能为空' }, 400);
  if (!row.desc) return json({ ok: false, message: '简介不能为空' }, 400);
  const next = previous ? rows.map((r, i) => (i === index ? row : r)) : [...rows, row];
  const response = await applyEdit(next, `${previous ? '已更新' : '已新增'}：${row.title}`, previous ? { from: previous.url, to: row.url } : undefined);
  return response;
};

/** gh CLI 已经用你的账号登录过（gh auth login），所以触发重建不需要额外的 token。
 * 测试里可以用 `GH_BIN` 指向假脚本，避免真的去触发一次线上构建。 */
const GH = process.env.GH_BIN || 'gh';
const gh = (args: string[]) =>
  execFileSync(GH, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const WORKFLOW_FILE = 'deploy.yml';

const currentBranch = () => {
  try {
    return git(['branch', '--show-current']) || 'master';
  } catch {
    return 'master';
  }
};

const handlePublish = () => {
  const running = tasks.running('publish');
  if (running.length) {
    return json({ ok: false, message: '上一次发布还在进行中，等它结束再试', id: running[0].id }, 409);
  }
  const task = tasks.start('publish', PUBLISH_STEPS);
  void runPublishTask(task.id);
  return json({ ok: true, id: task.id }, 202);
};

/** 同步数据 → 补图标 → 触发重建。
 *  每一步都写进任务快照，所以前端能显示「做到哪一步」「图标补到第几个域名」。 */
const runPublishTask = async (id: string) => {
  const warns: string[] = [];
  try {
    tasks.mark(id, 'sync', 'running');
    const client = clientFor();
    const data = await refreshCache(client);
    store.rows = data.links;
    store.statuses = data.status as Record<string, LinkStatus>;
    store.loaded = true;
    const validation = validateRows(store.rows, taxonomy());
    if (validation.errors.length) {
      const detail = `数据校验未通过，已中止发布（${validation.errors.length} 个问题）`;
      return tasks.fail(id, { stepId: 'sync', message: detail, result: { ok: false, message: detail, errors: validation.errors } });
    }
    warns.push(...validation.warns);
    const before = pendingDiff(store.rows);
    tasks.mark(id, 'sync', 'ok', `${store.rows.length} 条资源`);

    tasks.mark(id, 'icons', 'running');
    let total = 0;
    let done = 0;
    const icons = await spawnLines(process.execPath, ['scripts/fetch-icons.mjs'], {
      timeout: 180_000,
      onLine: (line) => {
        const plan = line.match(/(\d+) 个待抓/);
        if (plan) {
          total = Number(plan[1]);
          tasks.progress(id, 0, total);
          return;
        }
        if (!/^[✓✗]/.test(line)) return;
        done++;
        tasks.progress(id, done, total || done);
        tasks.detail(id, line.trim());
      },
    });
    if (!icons.ok) warns.push(`图标脚本失败：${tail(icons.stderr) || '未知原因'}`);
    tasks.mark(
      id,
      'icons',
      icons.ok ? 'ok' : 'fail',
      total ? `${done}/${total} 个域名` : icons.ok ? '没有要抓的域名' : '脚本报错，已跳过',
    );

    tasks.mark(id, 'dispatch', 'running');
    const branch = currentBranch();
    try {
      gh(['workflow', 'run', WORKFLOW_FILE, '--ref', branch]);
    } catch (error) {
      const detail = `触发失败：${gitError(error) || '请确认本机装了 gh 并已 gh auth login'}`;
      return tasks.fail(id, { stepId: 'dispatch', message: detail, result: { ok: false, message: detail } });
    }
    writePublished(store.rows, store.statuses);
    tasks.mark(id, 'dispatch', 'ok', branch);
    const parts = [
      before.added ? `新增 ${before.added} 条` : '',
      before.removed ? `删除 ${before.removed} 条` : '',
      before.changed ? `修改 ${before.changed} 条` : '',
    ].filter(Boolean);
    const detail = `已触发重建${parts.length ? `（${parts.join('、')}）` : ''}，约 1 分钟后上线`;
    return tasks.complete(id, { message: detail, result: { ok: true, message: detail, branch, warns } });
  } catch (error) {
    const detail = `发布失败：${(error as Error).message}`;
    return tasks.fail(id, { message: detail, result: { ok: false, message: detail } });
  }
};

const handleStatus = () => {
  const rows = readRows();
  const diff = pendingDiff(rows);
  const branch = currentBranch();
  // 发布只触发 Actions 重建、不推代码，所以本地未推送的提交得在工具条里提示出来。
  const remoteRef = `origin/${branch}`;
  const hasRemote = gitOr(['rev-parse', '--verify', remoteRef], '') !== '';
  const count = (range: string) => (hasRemote ? Number(gitOr(['rev-list', '--count', range], '0')) : null);
  const ahead = count(`${remoteRef}..HEAD`);
  const behind = count(`HEAD..${remoteRef}`);
  let publishedAt: string | null = null;
  try {
    publishedAt = JSON.parse(readFileSync(resolve(ROOT, PUBLISHED_REL), 'utf8')).publishedAt ?? null;
  } catch {
    publishedAt = null;
  }
  return json({
    ok: true,
    dirty: diff.added + diff.removed + diff.changed > 0,
    ...diff,
    branch,
    ahead,
    behind,
    total: rows.length,
    publishedAt,
    head: gitOr(['rev-parse', '--short', 'HEAD'], '?'),
  });
};


const handleMaintenance = () => {
  const rows = readRows();
  return json({ ok: true, tasks: maintenanceTasks(rows, readStatuses()) });
};

const handleRecheck = async (request: Request) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求体不是合法 JSON' }, 400);
  }
  const target = normUrl(body?.url);
  if (!target.url) return json({ ok: false, message: target.error }, 400);
  const rows = readRows();
  const row = rows.find((item) => urlKey(item.url) === urlKey(target.url as string));
  if (!row) return json({ ok: false, message: '链接不存在（可能已被改动）' }, 404);

  const status = datedStatus(await probeLink(row.url));
  const client = clientFor({ write: true });
  try {
    await client.upsertStatus({ ...status, url: row.url });
  } catch (error) {
    return json({ ok: false, message: `写库失败：${(error as Error).message}` }, 502);
  }
  store.statuses[row.url] = status;
  await refreshCache(client);
  // 维护面板靠这份列表整体重画：只回一条会把别的待办从界面上抹掉
  return json({ ok: true, status, tasks: maintenanceTasks(rows, readStatuses()) });
};

/**
 * 浏览器发的跨站请求一定带 Origin（同源 POST 也带）；没有 Origin 的是 curl / 脚本。
 * 挡住「随便点开一个恶意页面就能往本地 dev server 写盘、甚至 push」这种情况。
 */
const handleTask = (url: URL) => {
  const id = url.searchParams.get('id') ?? '';
  if (!id) return json({ ok: true, tasks: tasks.running() });
  const snapshot = tasks.get(id);
  if (!snapshot) return json({ ok: false, message: '没有这个任务（本地服务重启后会丢）' }, 404);
  return json({ ok: true, task: snapshot });
};

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
    const meta = await fetchMeta(target.url as string);
    // 采集/导入那条路要的「落点建议」：命中域名规则才给，给不出就是 null
    return json({ ...meta, rules: suggestFor(target.url as string, taxonomy()) });
  }

  try {
    if (route === 'edit' && method === 'POST') return await handleEdit(context.request);
    if (route === 'batch-meta' && method === 'POST') return await handleBatchMeta(context.request);
    if (route === 'batch-add' && method === 'POST') return await handleBatchAdd(context.request);
    if (route === 'import-bookmarks' && method === 'POST') return await handleImportBookmarks(context.request);
    if (route === 'duplicates' && method === 'POST') return await handleDuplicates(context.request);
    if (route === 'duplicates-scan' && method === 'GET') return handleDuplicatesScan();
    if (route === 'ai-draft' && method === 'POST') return await handleAiDraft(context.request);
    if (route === 'status' && method === 'GET') return handleStatus();
    if (route === 'publish-preview' && method === 'GET') return handlePublishPreview();
    if (route === 'maintenance' && method === 'GET') return handleMaintenance();
    if (route === 'recheck' && method === 'POST') return await handleRecheck(context.request);
    if (route === 'publish' && method === 'POST') return handlePublish();
    if (route === 'task' && method === 'GET') return handleTask(context.url);
  } catch (error) {
    return json({ ok: false, message: `${route} 失败：${gitError(error)}` }, 500);
  }

  return json({ ok: false, message: `未知接口：${route || '空'}` }, 404);
});
