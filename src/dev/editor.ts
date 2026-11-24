// dev 编辑层：只在 `npm run dev` 里被动态 import，构建时整块被摇掉。
// 端点见 src/middleware.ts；数据层的序列化与校验在 src/lib/link-data.mjs。
import './editor.css';
import type { LinkStatus, Resource } from '../lib/links';
import { pollTask, renderTask, emptyTask, type TaskSnapshot } from './task';
import { toast, type ToastTone } from './toast';

type Row = Resource;
type Draft = Row & { note?: string };
type LinkTask = { kind: 'fail' | 'redirect'; reason: string; row: Row; status: LinkStatus };
type Skipped = { url: string; reason: string; row?: Row };
type BatchMetaReply = { ok: boolean; message?: string; drafts?: Draft[]; skipped?: Skipped[] };
type ImportDraft = Draft & { folder?: string; guessed?: boolean };
type ImportReply = { ok: boolean; message?: string; drafts?: ImportDraft[]; skipped?: Skipped[]; total?: number };
type ScanGroup = { kind: string; label: string; items: Row[] };
type DuplicateReply = {
  ok: boolean;
  message?: string;
  cleanup?: { url: string; removed: string[] } | null;
  candidates?: { row: Row; reason: string }[];
};
type PublishPreview = {
  ok: boolean;
  message?: string;
  added: Row[];
  removed: Row[];
  changed: { before: Row; after: Row }[];
  statusChanged: boolean;
  icons: string[];
};
type MetaReply = ApiReply & {
  rules?: { section?: string[]; facets?: Record<string, Record<string, unknown>> } | null;
};

type ApiReply = {
  ok: boolean;
  message?: string;
  reason?: string;
  errors?: string[];
  title?: string;
  desc?: string;
  note?: string;
  dirty?: boolean;
  ahead?: number | null;
  behind?: number | null;
  pushed?: boolean;
  added?: number;
  removed?: number;
  changed?: number;
  branch?: string;
  head?: string;
  warns?: string[];
  tasks?: LinkTask[];
  status?: LinkStatus;
};

type AiDraftReply = ApiReply & {
  merged?: Row;
  kept?: string[];
  warnings?: string[];
  evidence?: string[];
  unverified?: number;
  final?: string;
  ms?: number;
};

const root = document.getElementById('dev');
const dialog = document.getElementById('dev-dialog') as HTMLDialogElement | null;
if (root && dialog) init(root, dialog);

function init(host: HTMLElement, dlg: HTMLDialogElement) {
  const base = host.dataset.base || '/';
  const api = (name: string) => `${base}api/${name}`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const url = $<HTMLInputElement>('f-url');
  const title = $<HTMLInputElement>('f-title');
  const desc = $<HTMLTextAreaElement>('f-desc');
  const added = $<HTMLInputElement>('f-added');
  const note = $<HTMLTextAreaElement>('f-note');
  const readBox = $<HTMLInputElement>('f-read');
  const fetchBtn = $<HTMLButtonElement>('f-fetch');
  const fetchMsg = $<HTMLSpanElement>('f-fetch-msg');
  const aiBtn = $<HTMLButtonElement>('f-ai');
  const aiMsg = $<HTMLSpanElement>('f-ai-msg');
  const aiEvidence = $<HTMLDivElement>('f-ai-evidence');
  const urlFeedback = $<HTMLDivElement>('f-url-feedback');
  const errBox = $<HTMLParagraphElement>('f-err');
  const saveBtn = $<HTMLButtonElement>('f-save');
  const deleteBtn = $<HTMLButtonElement>('f-delete');
  const batchDiscardBtn = $<HTMLButtonElement>('f-batch-discard');
  const cancelBtn = $<HTMLButtonElement>('f-cancel');
  const heading = $<HTMLHeadingElement>('dev-heading');
  const addBtn = $<HTMLButtonElement>('dev-add');
  const batchBtn = $<HTMLButtonElement>('dev-batch');
  const batchDlg = $<HTMLDialogElement>('dev-batch-dialog');
  const batchUrls = $<HTMLTextAreaElement>('dev-batch-urls');
  const batchMsg = $<HTMLParagraphElement>('dev-batch-msg');
  const batchSkipped = $<HTMLDivElement>('dev-batch-skipped');
  const batchStart = $<HTMLButtonElement>('dev-batch-start');
  const batchCancel = $<HTMLButtonElement>('dev-batch-cancel');
  const maintenanceBtn = $<HTMLButtonElement>('dev-maintenance');
  const maintenanceDlg = $<HTMLDialogElement>('dev-maintenance-dialog');
  const maintenanceList = $<HTMLDivElement>('dev-maintenance-list');
  const maintenanceClose = $<HTMLButtonElement>('dev-maintenance-close');
  const publishBtn = $<HTMLButtonElement>('dev-publish');
  const publishDlg = $<HTMLDialogElement>('dev-publish-dialog');
  const publishSummary = $<HTMLParagraphElement>('dev-publish-summary');
  const publishList = $<HTMLDivElement>('dev-publish-list');
  const publishErr = $<HTMLParagraphElement>('dev-publish-err');
  const publishConfirm = $<HTMLButtonElement>('dev-publish-confirm');
  const publishCancel = $<HTMLButtonElement>('dev-publish-cancel');
  const publishProgress = $<HTMLDivElement>('dev-publish-progress');
  const batchProgress = $<HTMLDivElement>('dev-batch-progress');
  const selectBar = $<HTMLDivElement>('dev-selectbar');
  const selectCount = $<HTMLSpanElement>('dev-select-count');
  const selectDelete = $<HTMLButtonElement>('dev-select-delete');
  const selectOpen = $<HTMLButtonElement>('dev-select-open');
  const scanBtn = $<HTMLButtonElement>('dev-scan');
  const scanDlg = $<HTMLDialogElement>('dev-scan-dialog');
  const scanList = $<HTMLDivElement>('dev-scan-list');
  const scanClose = $<HTMLButtonElement>('dev-scan-close');
  const selectClear = $<HTMLButtonElement>('dev-select-clear');
  const palette = $<HTMLDialogElement>('dev-palette');
  const paletteInput = $<HTMLInputElement>('dev-palette-input');
  const paletteList = $<HTMLUListElement>('dev-palette-list');
  const stateEl = $<HTMLSpanElement>('dev-state');
  const sectionBoxes = Array.from(dlg.querySelectorAll<HTMLInputElement>('input[data-section]'));
  const panels = Array.from(dlg.querySelectorAll<HTMLElement>('[data-panel]'));
  const pageSection = host.dataset.section || '';

  let editing: string | null = null;
  /** 编辑期间星标状态：currentDraft 要把它带回写盘，否则保存一次就丢置顶 */
  let editingPin = false;
  let qualitySeq = 0;
  let aiSeq = 0;
  let batchActive = false;
  let batchDrafts: Draft[] = [];
  let batchReviewed: Draft[] = [];
  let batchIndex = 0;
  let batchSkippedRows: Skipped[] = [];
  let pendingPublish: ApiReply | null = null;
  let publishTaskId: string | null = null;
  let publishFinished = false;

  /** 单次请求没有服务端进度可看，只能把已用秒数刷出来，至少让人知道没卡死 */
  const ticker = (el: HTMLElement, text: (seconds: number) => string) => {
    const started = Date.now();
    el.textContent = text(0);
    const id = window.setInterval(() => el.textContent = text(Math.round((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(id);
  };

  /** 任务快照 → 工具条上那一行小字：做到哪一步了 */
  const progressLine = (snap: TaskSnapshot) => {
    const running = snap.steps.find((step) => step.status === 'running');
    const where = running ? running.label : snap.status === 'ok' ? '收尾' : '停止';
    const sub = snap.progress && snap.progress.total > 0 ? ` ${snap.progress.done}/${snap.progress.total}` : '';
    return `${where}${running?.note ? ` · ${running.note}` : sub}`;
  };

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const say = (text: string, kind: 'idle' | 'dirty' | 'bad' = 'idle') => {
    stateEl.textContent = text;
    stateEl.title = text;
    stateEl.dataset.state = kind;
  };

  const fail = (text: string) => {
    errBox.hidden = !text;
    errBox.textContent = text;
  };

  async function send<T extends { ok: boolean } = ApiReply>(name: string, body?: unknown): Promise<T> {
    try {
      const res = await fetch(api(name), {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return (await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }))) as T;
    } catch {
      return { ok: false, message: '连不上本地预览服务，请检查连接后重试' } as unknown as T;
    }
  }

  /** 写盘后 Vite 会立即让 links.yaml 的模块失效（实测 150ms 内新页面已是新数据），稍等整页刷新即可 */
  const refresh = () => setTimeout(() => location.reload(), 150);

  /** 写盘会让页面立刻重载，Toast 来不及看。把提示存进 sessionStorage，重载后补弹。 */
  const FLASH_KEY = 'dev-flash';
  const flash = (message: string, tone: ToastTone = 'ok') =>
    sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, tone }));
  const resumeFlash = () => {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return;
    sessionStorage.removeItem(FLASH_KEY);
    try {
      const saved = JSON.parse(raw) as { message?: string; tone?: ToastTone };
      if (saved?.message) toast(saved.message, { tone: saved.tone ?? 'ok' });
    } catch {
      /* 坏数据直接丢 */
    }
  };

  // ---- 卡片上的编辑/删除按钮 ----
  const rowOf = (card: Element): Row => {
    const el = card as HTMLElement;
    let facets: Row['facets'] = {};
    try {
      facets = JSON.parse(el.dataset.facets || '{}') as Row['facets'];
    } catch {
      facets = {};
    }
    return {
      title: card.querySelector('h2')?.textContent?.trim() ?? '',
      url: card.getAttribute('href') ?? '',
      section: (el.dataset.section ?? '').split(' ').filter(Boolean),
      facets,
      desc: card.querySelector('.desc')?.textContent?.trim() ?? '',
      added: el.dataset.added ?? '',
      ...(el.dataset.pin === '1' ? { pin: true } : {}),
      ...(el.dataset.read === '1' ? { read: false } : {}),
      ...(el.dataset.noteText ? { note: el.dataset.noteText } : {}),
    };
  };

  /** 只显示已勾选分区的分类面板；没勾的分区不参与提交 */
  function syncPanels() {
    const picked = new Set(sectionBoxes.filter((box) => box.checked).map((box) => box.value));
    for (const panel of panels) panel.hidden = !picked.has(panel.dataset.panel || '');
  }

  /** 表单 → facets：多选轴收集成数组（一个没勾就是 []），单选轴取 select 的值 */
  function collectFacets(): Row['facets'] {
    const out: Row['facets'] = {};
    for (const box of sectionBoxes) {
      if (!box.checked) continue;
      const panel = dlg.querySelector<HTMLElement>(`[data-panel="${box.value}"]`);
      if (!panel) continue;
      const values: Record<string, string | string[]> = {};
      for (const input of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-facet-id]')) {
        const fid = input.dataset.facetId || '';
        if (input instanceof HTMLSelectElement) values[fid] = input.value;
        else if (input.checked) {
          const list = (values[fid] as string[]) ?? [];
          list.push(input.value);
          values[fid] = list;
        } else if (!values[fid]) values[fid] = [];
      }
      out[box.value] = values;
    }
    return out;
  }

  function fillFacets(row: Row | null) {
    for (const panel of panels) {
      const sid = panel.dataset.panel || '';
      const vals = row?.facets?.[sid] ?? {};
      for (const input of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-facet-id]')) {
        const value = vals[input.dataset.facetId || ''];
        if (input instanceof HTMLSelectElement) input.value = typeof value === 'string' ? value : '';
        else input.checked = Array.isArray(value) ? value.includes(input.value) : value === input.value;
      }
    }
  }

  // ---- 卡片多选：勾选后批量删除，删错了用 Toast 上的「撤销」加回去 ----
  const cardEls = Array.from(document.querySelectorAll<HTMLElement>('.card'));
  const pickBoxes = new Map<HTMLElement, HTMLInputElement>();
  const pickedRows = new Map<string, { card: HTMLElement; row: Row }>();
  let lastPickedUrl = '';

  function syncSelectBar() {
    selectBar.hidden = pickedRows.size === 0;
    selectCount.textContent = `已选 ${pickedRows.size} 条`;
    // 浮条是 fixed 的，会盖住最后几行卡片；显出来时把页面底部叠开
    document.body.classList.toggle('dev-bar-open', pickedRows.size > 0);
  }

  function setPick(card: HTMLElement, on: boolean) {
    const url = card.getAttribute('href') ?? '';
    if (!url) return;
    const box = pickBoxes.get(card);
    if (box) box.checked = on;
    card.classList.toggle('is-picked', on);
    if (on) pickedRows.set(url, { card, row: rowOf(card) });
    else pickedRows.delete(url);
    syncSelectBar();
  }

  /** 删掉后先从页面上抹掉这张卡片；不整页刷新，否则撤销的 Toast 也会被刷没了 */
  const dropCard = (targetUrl: string) => {
    const card = cardEls.find((item) => (item.getAttribute('href') ?? '') === targetUrl);
    if (!card) return;
    card.remove();
    const shownEl = document.getElementById('shown');
    const count = Number(shownEl?.textContent ?? '');
    if (shownEl && Number.isFinite(count)) shownEl.textContent = String(Math.max(0, count - 1));
  };

  /** 删除后写盘会让 Vite 整页重载（实测 <150ms），Toast 会跟着文档一起没。
   *  所以把待撤销的行存进 sessionStorage，重载后再把 Toast 摆回来，剩余时间照算。 */
  const UNDO_KEY = 'dev-undo';
  const UNDO_MS = 12_000;
  const clearUndo = () => sessionStorage.removeItem(UNDO_KEY);

  const offerUndo = (rows: Row[], options: { timeout?: number; at?: number } = {}) => {
    const total = rows.length;
    const at = options.at ?? Date.now();
    sessionStorage.setItem(UNDO_KEY, JSON.stringify({ rows, at }));
    toast(`已删除 ${total} 条`, {
      tone: 'ok',
      timeout: options.timeout ?? UNDO_MS,
      detail: '撤销后会把这几条原样加回去',
      action: {
        label: '撤销',
        run: async () => {
          clearUndo();
          let ok = 0;
          const failed: string[] = [];
          for (const row of rows) {
            const res = await send('edit', { action: 'add', ...row });
            if (res.ok) ok++;
            else failed.push(`${row.title}：${res.message || '添加失败'}`);
          }
          if (failed.length) flash(`只恢复了 ${ok}/${total} 条`, 'bad');
          else flash(`已恢复 ${ok} 条`, 'ok');
          refresh();
        },
      },
    });
  };

  /** 页面重载后把还没过期的撤销提示接回来 */
  const resumeUndo = () => {
    let pending: { rows: Row[]; at: number } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(UNDO_KEY) ?? 'null') as { rows: Row[]; at: number } | null;
    } catch {
      pending = null;
    }
    if (!pending?.rows?.length) {
      clearUndo();
      return;
    }
    const left = UNDO_MS - (Date.now() - pending.at);
    if (left < 800) {
      clearUndo();
      return;
    }
    offerUndo(pending.rows, { at: pending.at, timeout: left });
  };

  /** 置顶开关：只改 pin，不动其他字段 */
  async function togglePin(card: HTMLElement, star: HTMLButtonElement) {
    const row = rowOf(card);
    const next = card.dataset.pin !== '1';
    star.disabled = true;
    const res = await send('edit', {
      action: 'update',
      ...row,
      pin: next,
      newUrl: row.url,
    });
    star.disabled = false;
    if (!res.ok) {
      toast(res.errors?.length ? res.errors.join('；') : res.message || '置顶失败', { tone: 'bad' });
      return;
    }
    card.dataset.pin = next ? '1' : '';
    star.textContent = next ? '★' : '☆';
    star.classList.toggle('on', next);
    star.title = next ? '取消置顶' : '置顶（浏览时排在最前）';
    star.setAttribute('aria-pressed', next ? 'true' : 'false');
    flash(next ? `已置顶：${row.title}` : `已取消置顶：${row.title}`, 'ok');
    refresh();
  }

  for (const card of cardEls) {
    const box = document.createElement('span');
    box.className = 'dev-card-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = '编辑';
    edit.title = '编辑这一条';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '删除';
    del.title = '删除这一条';

    for (const btn of [edit, del]) {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    edit.addEventListener('click', () => open(rowOf(card)));
    del.addEventListener('click', () => {
      const row = rowOf(card);
      void remove(row.url, row.title, row);
    });

    box.append(edit, del);
    card.append(box);

    // 置顶星标：立即写盘。写盘会让 Vite 整页重载，所以提示走 flash 中转。
    const pinned = card.dataset.pin === '1';
    const star = document.createElement('button');
    star.type = 'button';
    star.className = `dev-star${pinned ? ' on' : ''}`;
    star.textContent = pinned ? '★' : '☆';
    star.title = pinned ? '取消置顶' : '置顶（浏览时排在最前）';
    star.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    star.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void togglePin(card, star);
    });
    box.prepend(star);

    const pick = document.createElement('input');
    pick.type = 'checkbox';
    pick.className = 'dev-card-pick';
    pick.title = '选中后可批量删除（Shift 连选）';
    pick.setAttribute('aria-label', `选中：${card.querySelector('h2')?.textContent?.trim() ?? '这条资源'}`);
    pick.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = card.getAttribute('href') ?? '';
      if (event.shiftKey && lastPickedUrl) {
        const from = cardEls.findIndex((item) => (item.getAttribute('href') ?? '') === lastPickedUrl);
        const to = cardEls.indexOf(card);
        if (from >= 0 && to >= 0) {
          const [start, end] = from <= to ? [from, to] : [to, from];
          for (let index = start; index <= end; index++) setPick(cardEls[index], pick.checked);
          lastPickedUrl = url;
          return;
        }
      }
      setPick(card, pick.checked);
      lastPickedUrl = url;
    });
    pickBoxes.set(card, pick);
    box.prepend(pick);
  }

  const currentDraft = (): Draft => ({
    title: title.value,
    url: url.value.trim(),
    desc: desc.value,
    added: added.value,
    ...(editingPin ? { pin: true } : {}),
    ...(readBox.checked ? { read: false } : {}),
    ...(note.value.trim() ? { note: note.value.trim() } : {}),
    section: sectionBoxes.filter((box) => box.checked).map((box) => box.value),
    facets: collectFacets(),
  });

  const updateBatchButton = () => {
    batchBtn.textContent = batchActive ? `继续批量（${batchIndex + 1}/${batchDrafts.length}）` : '批量导入';
  };

  const resetBatch = () => {
    batchActive = false;
    batchDrafts = [];
    batchReviewed = [];
    batchIndex = 0;
    batchSkippedRows = [];
    updateBatchButton();
  };

  const openBatchCurrent = () => open(batchDrafts[batchIndex], undefined, true);

  async function checkUrlQuality() {
    const seq = ++qualitySeq;
    const value = url.value.trim();
    urlFeedback.replaceChildren();
    urlFeedback.hidden = true;
    if (!value) return;
    const res = await send<DuplicateReply>('duplicates', { url: value, title: title.value, excludeUrl: editing });
    if (seq !== qualitySeq) return;
    if (!res.ok) {
      urlFeedback.textContent = res.message || 'URL 检查失败';
      urlFeedback.hidden = false;
      return;
    }

    if (res.cleanup) {
      const cleanup = res.cleanup;
      const line = document.createElement('div');
      line.className = 'dev-url-cleanup';
      const text = document.createElement('span');
      text.textContent = `可移除跟踪参数：${cleanup.removed.join('、')}`;
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.textContent = '使用清理后的 URL';
      apply.addEventListener('click', () => {
        url.value = cleanup.url;
        void checkUrlQuality();
      });
      line.append(text, apply);
      urlFeedback.append(line);
    }

    for (const candidate of res.candidates ?? []) {
      const item = document.createElement('div');
      item.className = 'dev-duplicate';
      const text = document.createElement('span');
      text.textContent = `${candidate.reason}：${candidate.row.title}`;
      item.append(text, externalLink('打开已有', candidate.row.url));
      urlFeedback.append(item);
    }
    if (res.candidates?.length) {
      const note = document.createElement('p');
      note.className = 'dev-url-note';
      note.textContent = '相似候选仅供参考；完全重复的 URL 仍会在保存时拦截。';
      urlFeedback.append(note);
    }
    urlFeedback.hidden = !urlFeedback.hasChildNodes();
  }

  // ---- 表单 ----
  function open(row: Draft | null, suggestedUrl?: string, isDraft = false) {
    if (batchActive && !isDraft) {
      toast('请先完成或放弃当前批量导入，再编辑其他资源。', { tone: 'bad' });
      return;
    }
    editing = isDraft ? null : row?.url ?? null;
    editingPin = !isDraft && row?.pin === true;
    heading.textContent = isDraft ? `批量导入 · ${batchIndex + 1}/${batchDrafts.length}` : row ? '编辑资源' : '新增资源';
    url.value = suggestedUrl ?? row?.url ?? '';
    title.value = row?.title ?? '';
    desc.value = row?.desc ?? '';
    added.value = row?.added ?? today();
    note.value = row?.note ?? '';
    readBox.checked = row?.read === false;
    const picked = row?.section?.length ? row.section : pageSection ? [pageSection] : [];
    for (const box of sectionBoxes) box.checked = picked.includes(box.value);
    fillFacets(row);
    syncPanels();
    deleteBtn.hidden = isDraft || !row;
    batchDiscardBtn.hidden = !isDraft;
    cancelBtn.textContent = isDraft ? '暂停' : '取消';
    saveBtn.disabled = false;
    saveBtn.textContent = isDraft ? (batchIndex === batchDrafts.length - 1 ? '校验并写入整批' : '确认，下一条') : '保存';
    const notes = [suggestedUrl && suggestedUrl !== row?.url ? '已填入建议的新地址，保存前请确认' : ''];
    if (isDraft && batchIndex === 0 && batchSkippedRows.length) notes.push(`已跳过 ${batchSkippedRows.length} 条无效或重复 URL`);
    fetchMsg.textContent = notes.filter(Boolean).join(' · ');
    aiMsg.textContent = '';
    renderEvidence([], false);
    fail('');
    qualitySeq++;
    urlFeedback.replaceChildren();
    urlFeedback.hidden = true;
    if (!dlg.open) dlg.showModal();
    if (suggestedUrl) {
      url.focus();
      url.select();
    } else {
      (row ? title : url).focus();
    }
    void checkUrlQuality();
  }

  async function fetchMeta() {
    const value = url.value.trim();
    if (!value) {
      fetchMsg.textContent = '先填 URL';
      return;
    }
    fetchBtn.disabled = true;
    const stopTick = ticker(fetchMsg, (s) => `抓取中… ${s} 秒`);
    const res = await send<MetaReply>('meta', { url: value });
    stopTick();
    fetchBtn.disabled = false;
    if (!res.ok) {
      fetchMsg.textContent = res.reason || res.message || '抓取失败';
      return;
    }
    const filled: string[] = [];
    if (res.title && !title.value.trim()) {
      title.value = res.title;
      filled.push('标题');
    }
    if (res.desc && !desc.value.trim()) {
      desc.value = res.desc;
      filled.push('简介');
    }
    // 落点建议：只在新增、且还没手勾过分区时套用，命中域名规则才可能有值
    const rules = res.rules;
    if (rules?.section?.length && !editing && !sectionBoxes.some((box) => box.checked)) {
      for (const box of sectionBoxes) box.checked = rules.section.includes(box.value);
      fillFacets({ facets: rules.facets } as unknown as Draft);
      syncPanels();
      filled.push('分区与分类（按域名猜的，请核对）');
    }
    fetchMsg.textContent = [filled.length ? `已填入${filled.join('、')}` : '抓到内容了，但你已填过，保持不变', res.note]
      .filter(Boolean)
      .join(' · ');
  }

  /** AI 生成结果的依据片段；模型没找到原文可引时整块隐藏 */
  function renderEvidence(quotes: string[], canOverwrite: boolean) {
    aiEvidence.replaceChildren();
    aiEvidence.hidden = !quotes.length && !canOverwrite;
    if (quotes.length) {
      const label = document.createElement('p');
      label.className = 'dev-ai-label';
      label.textContent = '简介依据的页面原文';
      const list = document.createElement('ul');
      for (const quote of quotes) {
        const item = document.createElement('li');
        item.textContent = `「${quote}」`;
        list.append(item);
      }
      aiEvidence.append(label, list);
    }
    if (canOverwrite) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'dev-ai-overwrite';
      again.textContent = '用 AI 结果覆盖已填内容';
      again.addEventListener('click', () => void aiDraft(true));
      aiEvidence.append(again);
    }
  }

  /** 只在用户显式点击时调模型；默认只填空白字段，覆盖要再确认一次 */
  async function aiDraft(overwrite = false) {
    const value = url.value.trim();
    if (!value) {
      aiMsg.textContent = '先填 URL';
      return;
    }
    if (overwrite && !confirm('用 AI 结果覆盖你已经填写的标题、简介与分类吗？')) return;

    const seq = ++aiSeq;
    aiBtn.disabled = true;
    const stopTick = ticker(aiMsg, (s) => `生成中… ${s} 秒（最长 45 秒）`);
    const res = await send<AiDraftReply>('ai-draft', { url: value, current: currentDraft(), overwrite });
    stopTick();
    if (seq !== aiSeq) return;
    aiBtn.disabled = false;

    if (!res.ok || !res.merged) {
      aiMsg.textContent = res.message || res.reason || '生成失败';
      renderEvidence([], false);
      return;
    }

    const merged = res.merged;
    if (merged.title) title.value = merged.title;
    if (merged.desc) desc.value = merged.desc;
    const picked = new Set(merged.section ?? []);
    for (const box of sectionBoxes) box.checked = picked.has(box.value);
    syncPanels();
    fillFacets({ ...currentDraft(), facets: merged.facets });

    const parts = [`已生成（${Math.round((res.ms ?? 0) / 1000)} 秒）`];
    if (res.kept?.length && !overwrite) parts.push(`保留了你的${res.kept.join('、')}`);
    if (res.final && res.final !== value) parts.push(`页面跳转到 ${res.final}`);
    if (res.unverified) parts.push(`${res.unverified} 条依据没在正文里找到，已忽略`);
    if (res.warnings?.length) parts.push(`需要核对：${res.warnings.join('；')}`);
    aiMsg.textContent = parts.join(' · ');
    renderEvidence(res.evidence ?? [], Boolean(res.kept?.length) && !overwrite);
  }

  aiBtn.addEventListener('click', () => void aiDraft(false));

  /** 破坏性按钮的两步确认：第一次点只把文案改成「确认…」，4 秒内再点才真的执行。
   *  比原生 confirm 顺手（不弹窗、不阻塞），也不会被浏览器自动化直接吞掉。 */
  const twoStep = (btn: HTMLButtonElement, armedText: string, action: () => void | Promise<void>) => {
    let timer = 0;
    const restore = () => {
      window.clearTimeout(timer);
      delete btn.dataset.armed;
      if (btn.dataset.restore) btn.textContent = btn.dataset.restore;
      btn.classList.remove('is-armed');
    };
    btn.addEventListener('click', () => {
      if (btn.dataset.armed === 'yes') {
        restore();
        void action();
        return;
      }
      btn.dataset.restore = btn.textContent ?? '';
      btn.dataset.armed = 'yes';
      btn.textContent = armedText;
      btn.classList.add('is-armed');
      window.clearTimeout(timer);
      timer = window.setTimeout(restore, 4000);
    });
  };

  async function remove(targetUrl: string, name?: string, row?: Row) {
    if (batchActive) {
      toast('请先完成或放弃当前批量导入，再删除其他资源。', { tone: 'bad' });
      return;
    }
    const res = await send('edit', { action: 'delete', url: targetUrl });
    if (!res.ok) {
      say(res.message || '删除失败', 'bad');
      toast(res.message || '删除失败', { tone: 'bad' });
      return;
    }
    dlg.close();
    say(res.message || '已删除');
    dropCard(targetUrl);
    if (row) offerUndo([row]);
  }

  saveBtn.addEventListener('click', async () => {
    const nextUrl = url.value.trim();
    if (!nextUrl) return fail('URL 不能为空');

    if (batchActive) {
      const draft = currentDraft();
      const last = batchIndex === batchDrafts.length - 1;
      saveBtn.disabled = true;
      const res = await send('batch-add', last
        ? { rows: [...batchReviewed, draft] }
        : { rows: [draft], dryRun: true });
      saveBtn.disabled = false;
      if (!res.ok) {
        fail(res.errors?.length ? res.errors.join('；') : res.message || '草稿校验失败');
        return;
      }
      if (!last) {
        batchReviewed.push(draft);
        batchIndex++;
        updateBatchButton();
        openBatchCurrent();
        return;
      }
      dlg.close();
      resetBatch();
      batchUrls.value = '';
      flash(res.message || '已批量导入', 'ok');
      refresh();
      return;
    }

    const payload = {
      action: editing ? 'update' : 'add',
      ...currentDraft(),
      url: editing ?? nextUrl,
      ...(editing ? { newUrl: nextUrl } : {}),
    };
    saveBtn.disabled = true;
    const res = await send('edit', payload);
    saveBtn.disabled = false;
    if (!res.ok) {
      fail(res.errors?.length ? res.errors.join('；') : res.message || '保存失败');
      return;
    }
    dlg.close();
    flash(res.message || '已保存', 'ok');
    refresh();
  });

  deleteBtn.addEventListener('click', () => {
    if (editing) void remove(editing, title.value, currentDraft());
  });
  cancelBtn.addEventListener('click', () => {
    if (batchActive) batchDrafts[batchIndex] = currentDraft();
    dlg.close();
  });
  dlg.addEventListener('cancel', () => {
    if (batchActive) batchDrafts[batchIndex] = currentDraft();
  });
  fetchBtn.addEventListener('click', () => void fetchMeta());

  // 回车不提交原生表单（否则会带 query 重载页面）
  dlg.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveBtn.click();
  });

  // 填完 URL 就检查候选；新增且标题为空时再自动抓一次元信息。
  url.addEventListener('change', () => {
    void checkUrlQuality();
    if (!editing && !title.value.trim()) void fetchMeta();
  });
  title.addEventListener('change', () => void checkUrlQuality());

  addBtn.addEventListener('click', () => open(null));

  // 「收录」书签：拖到书签栏后，在任何页面点一下 → 新窗口打开本页并带上地址与标题。
  // 纯前端拼 javascript: 协议，不新增接口，也不落库。
  const captureLink = $<HTMLAnchorElement>('dev-capture');
  if (captureLink) {
    const target = `${location.origin}${location.pathname}`;
    captureLink.href =
      `javascript:(function(){window.open('${target}?add=' + encodeURIComponent(location.href) + '&title=' + encodeURIComponent(document.title), '_blank')})()`;
  }

  const captured = new URLSearchParams(location.search);
  const capturedUrl = (captured.get('add') ?? '').trim();
  if (capturedUrl) {
    const capturedTitle = (captured.get('title') ?? '').trim().slice(0, 80);
    // 地址栏里别留着参数，刷新或分享时不该再触发一次
    history.replaceState(null, '', location.pathname);
    open(null);
    url.value = capturedUrl;
    // 先清空标题再触发 change：fetchMeta 只在标题为空时才抓，
    // 但「落点建议」（分区/分类）与标题无关，会一并回来。
    title.value = '';
    url.dispatchEvent(new Event('change'));
    if (capturedTitle) title.value = capturedTitle;
  }
  for (const box of sectionBoxes) box.addEventListener('change', syncPanels);

  // ---- 导入浏览器书签文件：先出草稿让人确认，再一次性写入 ----
  const importBtn = $<HTMLButtonElement>('dev-import');
  const importFile = $<HTMLInputElement>('dev-import-file');
  const importDlg = $<HTMLDialogElement>('dev-import-dialog');
  const importList = $<HTMLDivElement>('dev-import-list');
  const importSummary = $<HTMLParagraphElement>('dev-import-summary');
  const importMsg = $<HTMLParagraphElement>('dev-import-msg');
  const importCommit = $<HTMLButtonElement>('dev-import-commit');
  const importClose = $<HTMLButtonElement>('dev-import-close');
  let importRows: ImportDraft[] = [];

  const renderImport = (reply: ImportReply) => {
    importRows = (reply.drafts ?? []).filter((draft) => draft.section.length > 0);
    const skipped = reply.skipped ?? [];
    const needSection = (reply.drafts ?? []).length - importRows.length;
    importSummary.textContent = `文件里共 ${reply.total ?? 0} 条链接：可导入 ${importRows.length} 条，库里已有或无效 ${skipped.length} 条${needSection ? `，${needSection} 条没认出分区（先去「＋ 新增」里逐条收）` : ''}。导入的条目都会标成「待看」，简介先写成占位文字。`;
    importList.replaceChildren();
    for (const draft of (reply.drafts ?? []).slice(0, 200)) {
      const line = document.createElement('p');
      const text = document.createElement('span');
      const host = (() => {
        try {
          return new URL(draft.url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();
      text.textContent = `${draft.section.length ? '✓' : '·'} ${draft.title} — ${host}${draft.folder ? `（${draft.folder}）` : ''} `;
      if (!draft.section.length) text.className = 'dev-skip';
      line.append(text);
      line.append(externalLink(draft.url, '打开'));
      importList.append(line);
    }
    importMsg.textContent = skipped.length ? `已跳过：${skipped.slice(0, 5).map((item) => item.reason).join(' / ')}${skipped.length > 5 ? ' …' : ''}` : '';
    importCommit.textContent = importRows.length ? `导入 ${importRows.length} 条` : '没有可导入的条目';
    importCommit.disabled = importRows.length === 0;
    importDlg.showModal();
  };

  importBtn.addEventListener('click', () => importFile.click());
  importClose.addEventListener('click', () => importDlg.close());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) return;
    if (file.size > 8_000_000) {
      toast('书签文件太大（上限 8 MB）', { tone: 'bad' });
      return;
    }
    const html = await file.text();
    const reply = await send<ImportReply>('import-bookmarks', { html });
    if (!reply.ok) {
      toast(reply.message ?? '读不出这个书签文件', { tone: 'bad' });
      return;
    }
    renderImport(reply);
  });
  importCommit.addEventListener('click', async () => {
    importCommit.disabled = true;
    importMsg.textContent = '写入中…';
    const reply = await send<{ ok: boolean; message?: string; total?: number }>('import-bookmarks', {
      commit: true,
      rows: importRows,
    });
    importCommit.disabled = false;
    if (!reply.ok) {
      importMsg.textContent = reply.message ?? '导入失败';
      return;
    }
    importDlg.close();
    toast(reply.message ?? `已导入 ${importRows.length} 条`, { tone: 'ok' });
    window.setTimeout(() => location.reload(), 600);
  });

  // ---- 批量导入：先抓内存草稿，逐条 dry-run 校验，最后一次写入 ----
  function renderSkipped(items: Skipped[]) {
    batchSkipped.replaceChildren();
    for (const item of items) {
      const line = document.createElement('p');
      const text = document.createElement('span');
      text.textContent = `${item.reason}：${item.row?.title || item.url} `;
      line.append(text);
      if (item.row) line.append(externalLink('打开已有', item.row.url));
      batchSkipped.append(line);
    }
  }

  batchBtn.addEventListener('click', () => {
    if (batchActive) {
      openBatchCurrent();
      return;
    }
    batchMsg.textContent = '';
    batchSkipped.replaceChildren();
    batchDlg.showModal();
  });
  batchCancel.addEventListener('click', () => batchDlg.close());
  batchStart.addEventListener('click', async () => {
    // 只按行/逗号切分：按空白切会把「not a url」拆成三个垃圾地址，还会去抓不存在的站。
    const urls = batchUrls.value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!urls.length) {
      batchMsg.textContent = '请先粘贴 URL。';
      return;
    }
    if (urls.length > 20) {
      batchMsg.textContent = '每批最多 20 条，请分批导入。';
      return;
    }
    batchStart.disabled = true;
    batchStart.textContent = '抓取中…';
    batchSkipped.replaceChildren();
    const created = await send<{ ok: boolean; id?: string; message?: string }>('batch-meta', { urls });
    if (!created.ok || !created.id) {
      batchStart.disabled = false;
      batchStart.textContent = '抓取草稿';
      batchMsg.textContent = created.message || '批量抓取失败';
      return;
    }
    renderTask(batchProgress, emptyTask('batch-meta'));
    const snap = await pollTask(created.id, {
      interval: 400,
      onUpdate: (state) => {
        renderTask(batchProgress, state);
        const total = state.progress?.total ?? urls.length;
        if (state.status === 'running') say(`抓取中 ${state.progress?.done ?? 0}/${total}`);
      },
    });
    batchStart.disabled = false;
    batchStart.textContent = '抓取草稿';
    renderTask(batchProgress, snap);
    if (snap.status !== 'ok') {
      batchMsg.textContent = snap.message || '批量抓取失败';
      return;
    }
    const res = snap.result as BatchMetaReply;
    if (!res.ok) {
      batchMsg.textContent = res.message || '批量抓取失败';
      return;
    }
    batchSkippedRows = res.skipped ?? [];
    renderSkipped(batchSkippedRows);
    batchDrafts = res.drafts ?? [];
    if (!batchDrafts.length) {
      batchMsg.textContent = '没有可导入的新 URL。';
      return;
    }
    batchReviewed = [];
    batchIndex = 0;
    batchActive = true;
    updateBatchButton();
    batchDlg.close();
    openBatchCurrent();
  });
  twoStep(batchDiscardBtn, '确认放弃', () => {
    resetBatch();
    dlg.close();
    say('已放弃批量草稿');
  });
  window.addEventListener('beforeunload', (event) => {
    if (!batchActive) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // ---- 链接维护 ----
  const externalLink = (label: string, href: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    return link;
  };

  const actionButton = (label: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    return button;
  };

  function maintenanceItem(task: LinkTask) {
    const item = document.createElement('article');
    item.className = 'dev-maintenance-item';

    const head = document.createElement('div');
    head.className = 'dev-maintenance-item-head';
    const name = document.createElement('strong');
    name.textContent = task.row.title;
    const kind = document.createElement('span');
    kind.className = `dev-maintenance-kind ${task.kind}`;
    kind.textContent = task.kind === 'fail' ? '可能失效' : '重定向待确认';
    head.append(name, kind);

    const reason = document.createElement('p');
    reason.className = 'dev-maintenance-reason';
    const checked = task.status.checked ? ` · 最近检查 ${task.status.checked}` : '';
    reason.textContent = `${task.reason}${checked}`;

    const original = document.createElement('p');
    original.className = 'dev-maintenance-url';
    original.append(document.createTextNode('原地址：'), externalLink(task.row.url, task.row.url));
    item.append(head, reason, original);

    if (task.status.final && task.status.final !== task.row.url) {
      const final = document.createElement('p');
      final.className = 'dev-maintenance-url';
      final.append(document.createTextNode('最终地址：'), externalLink(task.status.final, task.status.final));
      item.append(final);
    }

    const actions = document.createElement('div');
    actions.className = 'dev-maintenance-actions';
    const recheck = actionButton('单条复查');
    recheck.addEventListener('click', async () => {
      recheck.disabled = true;
      recheck.textContent = '复查中…';
      const res = await send('recheck', { url: task.row.url });
      if (!res.ok) {
        toast(res.message || '复查失败', { tone: 'bad' });
        recheck.disabled = false;
        recheck.textContent = '单条复查';
        return;
      }
      await loadMaintenance();
    });

    const edit = actionButton(task.kind === 'redirect' ? '编辑替代地址' : '编辑链接');
    edit.addEventListener('click', () => {
      maintenanceDlg.close();
      open(task.row, task.kind === 'redirect' ? task.status.final : undefined);
    });
    actions.append(recheck, edit);

    if (task.kind === 'redirect' && task.status.final) {
      const adopt = actionButton('采用新地址');
      adopt.className = 'primary';
      adopt.addEventListener('click', async () => {
        adopt.disabled = true;
        const res = await send('edit', {
          action: 'update',
          url: task.row.url,
          newUrl: task.status.final,
        });
        if (!res.ok) {
          adopt.disabled = false;
          toast(res.errors?.join('；') || res.message || '更新失败', { tone: 'bad' });
          return;
        }
        say(res.message || '已采用新地址');
        flash(res.message || '已采用新地址', 'ok');
        refresh();
      });
      actions.append(adopt);
    }

    item.append(actions);
    return item;
  }

  async function loadMaintenance() {
    const res = await send('maintenance');
    if (!res.ok) {
      maintenanceBtn.textContent = '链接维护（读取失败）';
      return;
    }
    const tasks = res.tasks ?? [];
    maintenanceBtn.textContent = `链接维护${tasks.length ? `（${tasks.length}）` : ''}`;
    maintenanceList.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement('p');
      empty.className = 'dev-maintenance-empty';
      empty.textContent = '暂无需要处理的链接。';
      maintenanceList.append(empty);
      return;
    }
    maintenanceList.append(...tasks.map(maintenanceItem));
  }

  maintenanceBtn.addEventListener('click', () => {
    if (batchActive) {
      toast('请先完成或放弃当前批量导入，再处理链接维护。', { tone: 'bad' });
      return;
    }
    maintenanceDlg.showModal();
    void loadMaintenance();
  });
  maintenanceClose.addEventListener('click', () => maintenanceDlg.close());

  // ---- 全库查重 ----
  function renderScan(reply: { ok: boolean; message?: string; checked?: number; groups?: ScanGroup[] }) {
    scanList.replaceChildren();
    if (!reply.ok) {
      const p = document.createElement('p');
      p.className = 'dev-err';
      p.textContent = reply.message || '查重失败';
      scanList.append(p);
      return;
    }
    const groups = reply.groups ?? [];
    const head = document.createElement('p');
    head.className = 'dev-scan-head';
    head.textContent = groups.length
      ? `检查了 ${reply.checked ?? 0} 条，发现 ${groups.length} 组重复`
      : `检查了 ${reply.checked ?? 0} 条，没发现能确定的重复`;
    scanList.append(head);

    for (const group of groups) {
      const block = document.createElement('div');
      block.className = 'dev-scan-group';
      const label = document.createElement('p');
      label.className = 'dev-scan-label';
      label.textContent = `${group.label}（${group.items.length} 条）`;
      block.append(label);

      const list = document.createElement('ul');
      for (const row of group.items) {
        const item = document.createElement('li');
        const open = document.createElement('a');
        open.href = row.url;
        open.target = '_blank';
        open.rel = 'noreferrer';
        open.textContent = row.title;
        const where = document.createElement('span');
        where.className = 'dev-scan-url';
        where.textContent = row.url;
        item.append(open, where);
        list.append(item);
      }
      block.append(list);
      scanList.append(block);
    }
  }

  scanBtn.addEventListener('click', async () => {
    scanList.textContent = '正在查…';
    scanDlg.showModal();
    scanBtn.disabled = true;
    const reply = await send<{ ok: boolean; message?: string; checked?: number; groups?: ScanGroup[] }>('duplicates-scan');
    scanBtn.disabled = false;
    renderScan(reply);
  });
  scanClose.addEventListener('click', () => scanDlg.close());

  // ---- 发布 ----
  function showStatus(status: ApiReply) {
    const { dirty, ahead, behind, branch, head, added = 0, removed = 0, changed = 0 } = status;
    publishBtn.textContent = '发布';
    const notes: string[] = [];
    if (behind) notes.push(`落后 origin/${branch} ${behind} 个提交，请先在终端同步`);
    if (dirty) notes.push(added || removed || changed ? `未发布：+${added} −${removed} ~${changed}` : '数据文件有未提交改动');
    if (ahead) notes.push(`${ahead} 个本地提交尚未推送`);
    if (ahead === null) notes.push(`没有 origin/${branch} 的本地记录`);
    if (!dirty && !behind && status.ok) {
      if (ahead) publishBtn.textContent = '重试推送';
      else if (ahead === null) publishBtn.textContent = '推送分支';
    }
    const summary = status.ok ? notes.join('；') || `已同步 ${branch}@${head}` : status.message || '读不到状态';
    say(summary, !status.ok || behind ? 'bad' : notes.length ? 'dirty' : 'idle');
    return summary;
  }

  const formatValue = (value: unknown) => {
    if (Array.isArray(value)) return value.join('、') || '（空）';
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '') || '（空）';
  };

  function renderPublish(status: ApiReply, preview: PublishPreview | null) {
    const counts = preview
      ? `资源 +${preview.added.length} −${preview.removed.length} ~${preview.changed.length}`
      : '没有资源数据改动';
    publishSummary.textContent = `目标：origin/${status.branch} · ${counts}`;
    publishList.replaceChildren();

    const group = (label: string, rows: Row[], className: string) => {
      if (!rows.length) return;
      const titleEl = document.createElement('h4');
      titleEl.textContent = `${label}（${rows.length}）`;
      publishList.append(titleEl);
      for (const row of rows) {
        const item = document.createElement('article');
        item.className = `dev-publish-item ${className}`;
        const name = document.createElement('strong');
        name.textContent = row.title;
        const link = document.createElement('p');
        link.append(externalLink(row.url, row.url));
        item.append(name, link);
        publishList.append(item);
      }
    };

    if (preview) {
      group('新增资源', preview.added, 'added');
      group('删除资源', preview.removed, 'removed');
      if (preview.changed.length) {
        const titleEl = document.createElement('h4');
        titleEl.textContent = `修改资源（${preview.changed.length}）`;
        publishList.append(titleEl);
        for (const { before, after } of preview.changed) {
          const item = document.createElement('article');
          item.className = 'dev-publish-item changed';
          const name = document.createElement('strong');
          name.textContent = after.title;
          item.append(name);
          const fields = [
            ['title', '标题'], ['url', 'URL'], ['desc', '简介'],
            ['section', '分区'], ['facets', '分类'], ['added', '收录日期'],
          ] as const;
          for (const [key, label] of fields) {
            if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
            const line = document.createElement('p');
            line.className = 'dev-diff-field';
            line.textContent = `${label}：${formatValue(before[key])} → ${formatValue(after[key])}`;
            item.append(line);
          }
          publishList.append(item);
        }
      }

      const extras = document.createElement('div');
      extras.className = 'dev-publish-extras';
      if (preview.statusChanged) {
        const line = document.createElement('p');
        line.textContent = '链接体检状态有变化，将随本次发布提交。';
        extras.append(line);
      }
      if (preview.icons.length) {
        const titleEl = document.createElement('h4');
        titleEl.textContent = '图标与图标索引变化';
        extras.append(titleEl);
        for (const icon of preview.icons) {
          const line = document.createElement('code');
          line.textContent = icon;
          extras.append(line);
        }
      }
      if (!preview.added.length && !preview.removed.length && !preview.changed.length && !preview.statusChanged && !preview.icons.length) {
        const line = document.createElement('p');
        line.textContent = '资源内容、体检状态和图标均无差异，可能只有格式或注释变化。';
        extras.append(line);
      }
      publishList.append(extras);
    } else {
      const line = document.createElement('p');
      line.textContent = '只推送当前分支已有的本地提交，不创建数据提交。';
      publishList.append(line);
    }

    const plan = document.createElement('p');
    plan.className = 'dev-publish-plan';
    plan.textContent = status.dirty
      ? '步骤：校验 → 补抓缺失图标 → 提交数据 → 推送。发布时会包含该分支所有尚未推送的提交。'
      : '推送包含该分支所有尚未推送的提交。';
    publishList.append(plan);
    publishErr.hidden = true;
    publishErr.textContent = '';
  }

  publishBtn.addEventListener('click', async () => {
    if (batchActive) {
      toast('请先完成或放弃当前批量导入，再发布。', { tone: 'bad' });
      return;
    }
    if (publishTaskId) {
      publishDlg.showModal();
      return;
    }
    publishBtn.disabled = true;
    try {
      const status = await send('status');
      const summary = showStatus(status);
      if (!status.ok || status.behind || (!status.dirty && status.ahead === 0)) return;
      const preview = status.dirty ? await send<PublishPreview>('publish-preview') : null;
      if (preview && !preview.ok) {
        say(preview.message || '读取变更预览失败', 'bad');
        toast(preview.message || '读取变更预览失败', { tone: 'bad' });
        return;
      }
      pendingPublish = status;
      publishFinished = false;
      publishConfirm.textContent = '确认发布';
      publishProgress.hidden = true;
      publishProgress.replaceChildren();
      renderPublish(status, preview);
      publishDlg.showModal();
      publishSummary.title = summary;
    } finally {
      publishBtn.disabled = false;
    }
  });

  /** 收尾：成功就把四步全✓留在屏幕上等你看完，失败则给可重试的 Toast */
  const finishPublish = (snap: TaskSnapshot) => {
    renderTask(publishProgress, snap);
    say(progressLine(snap), snap.status === 'ok' ? 'idle' : 'bad');
    publishConfirm.disabled = false;
    publishCancel.disabled = false;
    const res = (snap.result ?? {}) as ApiReply;
    if (snap.status !== 'ok' || !res.ok) {
      const message = [snap.message || res.message || '发布失败', ...(res.errors ?? [])].join('\n');
      publishErr.textContent = message;
      publishErr.hidden = false;
      say(res.message || snap.message || '发布失败', 'bad');
      toast('发布失败', {
        tone: 'bad',
        detail: message,
        action: { label: '重试', run: () => { if (!publishConfirm.disabled) publishConfirm.click(); } },
      });
      return;
    }
    pendingPublish = null;
    publishBtn.textContent = '发布';
    const warns = res.warns ?? [];
    say(res.message || '已推送', warns.length ? 'dirty' : 'idle');
    toast(warns.length ? '已发布，有需要留意的改动' : '已发布', {
      tone: warns.length ? 'warn' : 'ok',
      detail: warns.length ? warns.join('；') : undefined,
      timeout: warns.length ? 15_000 : 6000,
    });
    publishFinished = true;
    publishConfirm.textContent = '完成并刷新';
    publishConfirm.disabled = false;
    publishCancel.disabled = false;
  };

  /** 轮询一个发布任务直到结束。整页刷新会重置脚本（图标写盘会触发 Vite 重载），
   *  所以这段必须在加载时能重新接上，不能只活在确认按钮的回调里。 */
  const watchPublish = async (id: string) => {
    publishTaskId = id;
    let snap: TaskSnapshot;
    try {
      snap = await pollTask(id, {
        interval: 300,
        onUpdate: (state) => {
          renderTask(publishProgress, state);
          if (state.status === 'running') say(progressLine(state), 'dirty');
        },
      });
    } finally {
      publishTaskId = null;
    }
    finishPublish(snap);
  };

  publishConfirm.addEventListener('click', async () => {
    // 发布完成后按钮变成「完成并刷新」：四步全✓和用时留在屏幕上，等你看完再刷新
    if (publishFinished) {
      location.reload();
      return;
    }
    const status = pendingPublish;
    if (!status) return;
    publishConfirm.disabled = true;
    publishErr.hidden = true;
    publishProgress.hidden = false;
    renderTask(publishProgress, emptyTask('publish'));
    // send 没给 body 会发 GET；发布必须 POST，所以传一个空对象把方法扳过去
    const created = await send<{ ok: boolean; id?: string; message?: string }>('publish', {});
    if (!created.ok || !created.id) {
      publishConfirm.disabled = false;
      publishErr.textContent = created.message || '发布任务创建失败';
      publishErr.hidden = false;
      return;
    }
    sessionStorage.setItem(PUBLISH_KEY, created.id);
    await watchPublish(created.id);
  });

  /** 发布成功后：关对话框才刷新，避免页面在进度条刚走满时闪掉 */
  const closePublished = (event?: Event) => {
    if (event) event.preventDefault();
    if (publishFinished) {
      sessionStorage.removeItem(PUBLISH_KEY);
      location.reload();
      return;
    }
    pendingPublish = null;
    publishDlg.close();
  };

  publishCancel.addEventListener('click', () => closePublished());
  publishDlg.addEventListener('cancel', (event) => {
    // 发布中允许关掉对话框：任务在服务端继续跑，工具条上的进度仍能看到
    if (publishFinished) return closePublished(event);
    if (!publishConfirm.disabled) pendingPublish = null;
  });

  // ---- 多选后的批量删除 ----
  selectClear.addEventListener('click', () => {
    for (const entry of [...pickedRows.values()]) setPick(entry.card, false);
  });

  // 「全部打开」：逐个弹窗。浏览器对一次点击里多次 window.open 的限制不一致，
  // 所以数真实的 null 返回，把可能被拦的个数直接报出来，不静默失败。
  selectOpen.addEventListener('click', () => {
    const entries = [...pickedRows.values()];
    if (!entries.length) return;
    let blocked = 0;
    for (const entry of entries) {
      const win = window.open(entry.row.url, '_blank');
      if (!win) blocked++;
      else win.opener = null;
    }
    const opened = entries.length - blocked;
    toast(blocked ? `打开了 ${opened} 个，${blocked} 个可能被拦` : `已打开 ${opened} 个链接`, {
      tone: blocked ? 'bad' : 'ok',
      detail: blocked ? '浏览器可能拦了弹窗：允许本站弹窗后重试' : undefined,
    });
  });

  selectDelete.addEventListener('click', async () => {
    const entries = [...pickedRows.values()];
    if (!entries.length) return;
    selectDelete.disabled = true;
    const removed: Row[] = [];
    try {
      for (const entry of entries) {
        const res = await send('edit', { action: 'delete', url: entry.row.url });
        if (!res.ok) {
          toast(`删除「${entry.row.title}」失败`, { tone: 'bad', detail: res.message });
          break;
        }
        removed.push(entry.row);
        setPick(entry.card, false);
        dropCard(entry.row.url);
        say(`已删除 ${removed.length}/${entries.length}`);
      }
    } finally {
      selectDelete.disabled = false;
      syncSelectBar();
    }
    if (!removed.length) return;
    say(`已删除 ${removed.length} 条`);
    offerUndo(removed);
  });

  // ---- 命令面板与快捷键 ----
  type Command = { label: string; hint: string; run: () => void };
  const commands = (): Command[] => [
    { label: '新增资源', hint: '打开新增表单', run: () => open(null) },
    { label: '批量导入', hint: '一次粘贴多条 URL', run: () => batchBtn.click() },
    { label: '链接维护', hint: '失效与重定向待确认', run: () => maintenanceBtn.click() },
    { label: '发布', hint: '校验、补图标、提交并推送', run: () => publishBtn.click() },
    { label: '全库查重', hint: '同 URL、清参数后相同、同站点同名', run: () => scanBtn.click() },
    { label: '聚焦搜索框', hint: '/', run: () => document.getElementById('q')?.focus() },
    { label: '重新加载页面', hint: '未保存的草稿会丢', run: () => location.reload() },
  ];
  let paletteItems: Command[] = [];
  let paletteIndex = 0;

  const renderPalette = () => {
    const query = paletteInput.value.trim().toLowerCase();
    paletteItems = commands().filter((command) =>
      !query || `${command.label} ${command.hint}`.toLowerCase().includes(query),
    );
    paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
    paletteList.replaceChildren();
    if (!paletteItems.length) {
      const empty = document.createElement('li');
      empty.className = 'dev-palette-empty';
      empty.textContent = '没有匹配的动作';
      paletteList.append(empty);
      return;
    }
    paletteItems.forEach((command, index) => {
      const item = document.createElement('li');
      item.className = index === paletteIndex ? 'is-active' : '';
      const name = document.createElement('span');
      name.textContent = command.label;
      const hint = document.createElement('small');
      hint.textContent = command.hint;
      item.append(name, hint);
      item.addEventListener('click', () => runPalette(index));
      paletteList.append(item);
    });
  };

  const runPalette = (index: number) => {
    const command = paletteItems[index];
    closePalette();
    command?.run();
  };

  function closePalette() {
    if (palette.open) palette.close();
    paletteInput.value = '';
    paletteIndex = 0;
  }

  const openPalette = () => {
    paletteInput.value = '';
    paletteIndex = 0;
    renderPalette();
    if (!palette.open) palette.showModal();
    paletteInput.focus();
  };

  paletteInput.addEventListener('input', () => {
    paletteIndex = 0;
    renderPalette();
  });
  paletteInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!paletteItems.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      paletteIndex = (paletteIndex + step + paletteItems.length) % paletteItems.length;
      renderPalette();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runPalette(paletteIndex);
    }
  });
  palette.addEventListener('click', (event) => {
    if (event.target === palette) closePalette();
  });
  palette.addEventListener('close', () => {
    paletteInput.value = '';
  });

  document.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (palette.open) closePalette();
      else openPalette();
      return;
    }
    if (event.key === 'Escape') {
      if (palette.open) {
        event.preventDefault();
        closePalette();
      }
      return;
    }
    if (meta && event.key === 'Enter' && dlg.open) {
      event.preventDefault();
      if (!saveBtn.disabled) saveBtn.click();
    }
  });

  /** 补图标会写 icons.json，Vite 会因此整页重载；所以任务 id 存 sessionStorage，
   *  重载后还能把这个任务的进度（以及已完成的结果）接回来。 */
  const PUBLISH_KEY = 'dev-publish-task';
  const resumePublish = async () => {
    const id = sessionStorage.getItem(PUBLISH_KEY);
    if (!id) return;
    const state = await send<{ ok: boolean; task?: TaskSnapshot }>(`task?id=${encodeURIComponent(id)}`);
    if (!state.ok || !state.task) {
      sessionStorage.removeItem(PUBLISH_KEY);
      return;
    }
    const snapshot = state.task;
    publishFinished = false;
    publishProgress.hidden = false;
    publishList.replaceChildren();
    publishConfirm.textContent = '确认发布';
    renderTask(publishProgress, snapshot);
    publishSummary.textContent = snapshot.status === 'running' ? '发布正在进行（仍在后台跑）' : '上次发布的进度';
    publishDlg.showModal();
    if (snapshot.status === 'running') {
      publishConfirm.disabled = true;
      await watchPublish(snapshot.id);
    } else {
      finishPublish(snapshot);
    }
    sessionStorage.removeItem(PUBLISH_KEY);
  };

  void send('status').then(showStatus);
  void loadMaintenance();
  void resumePublish();
  resumeUndo();
  resumeFlash();
}
