// dev 编辑层：只在 `npm run dev` 里被动态 import，构建时整块被摇掉。
// 端点见 src/middleware.ts；数据层的序列化与校验在 src/lib/link-data.mjs。
import './editor.css';
import {
  $,
  editPayload,
  externalLink,
  ticker,
  twoStep,
  type AiDraftReply,
  type ApiReply,
  type BatchMetaReply,
  type Deps,
  type Draft,
  type DuplicateReply,
  type MetaReply,
  type Row,
  type Skipped,
} from './editor-shared';
import { setupImport } from './editor-import';
import { setupMaintenance } from './editor-maintenance';
import { setupPublish } from './editor-publish';
import { setupScan } from './editor-scan';
import { emptyTask, pollTask, renderTask } from './task';
import { toast, type ToastTone } from './toast';

const root = document.getElementById('dev');
const dialog = document.getElementById('dev-dialog') as HTMLDialogElement | null;
if (root && dialog) init(root, dialog);

function init(host: HTMLElement, dlg: HTMLDialogElement) {
  const base = host.dataset.base || '/';
  const api = (name: string) => `${base}api/${name}`;

  const url = $<HTMLInputElement>('f-url');
  const title = $<HTMLInputElement>('f-title');
  const desc = $<HTMLTextAreaElement>('f-desc');
  const added = $<HTMLInputElement>('f-added');
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
  const publishBtn = $<HTMLButtonElement>('dev-publish');
  const batchProgress = $<HTMLDivElement>('dev-batch-progress');
  const selectBar = $<HTMLDivElement>('dev-selectbar');
  const selectCount = $<HTMLSpanElement>('dev-select-count');
  const selectDelete = $<HTMLButtonElement>('dev-select-delete');
  const selectOpen = $<HTMLButtonElement>('dev-select-open');
  const scanBtn = $<HTMLButtonElement>('dev-scan');
  const selectClear = $<HTMLButtonElement>('dev-select-clear');
  const palette = $<HTMLDialogElement>('dev-palette');
  const paletteInput = $<HTMLInputElement>('dev-palette-input');
  const paletteList = $<HTMLUListElement>('dev-palette-list');
  const stateEl = $<HTMLSpanElement>('dev-state');
  const sectionBoxes = Array.from(dlg.querySelectorAll<HTMLInputElement>('input[data-section]'));
  const panels = Array.from(dlg.querySelectorAll<HTMLElement>('[data-panel]'));
  const pageSection = host.dataset.section || '';

  let editing: { row: Row; initial: Row } | null = null;
  let qualitySeq = 0;
  let aiSeq = 0;
  let batchActive = false;
  let batchDrafts: Draft[] = [];
  let batchReviewed: Draft[] = [];
  let batchIndex = 0;
  let batchSkippedRows: Skipped[] = [];

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
    // 表单比屏幕高：错误框可能在视口外，不滚过去用户会以为点了没反应
    if (text) errBox.scrollIntoView({ block: 'nearest' });
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

  /** 写库后缓存已刷新；Vite 会让页面模块失效，稍等整页刷新即可 */
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

  /** 批量导入进行中时挡住其它入口：返回 false 表示已经弹过提示，调用方直接 return */
  const guardBatch = (what: string) => {
    if (!batchActive) return true;
    toast(`请先完成或放弃当前批量导入，再${what}。`, { tone: 'bad' });
    return false;
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
      ...(el.dataset.read === '1' ? { read: false } : {}),
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

  function fillFacets(facets?: Row['facets']) {
    for (const panel of panels) {
      const sid = panel.dataset.panel || '';
      const vals = facets?.[sid] ?? {};
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

  /** 删掉后直接从页面上抹掉这张卡片；不整页刷新，否则撤销的 Toast 也会被刷没了 */
  const dropCard = (targetUrl: string) => {
    const card = cardEls.find((item) => (item.getAttribute('href') ?? '') === targetUrl);
    if (!card) return;
    // 卡片外面还包着一层 .card-slot（给「详情」链接留位置），连带它一起去掉，否则留下一个空格子
    (card.closest('.card-slot') ?? card).remove();
    // 「显示 N / 总数」、分区与分类计数、最近 7 天全交给 filter.ts 重算：它从 DOM 现取卡片
    document.dispatchEvent(new CustomEvent('dev:cards-changed', { detail: card }));
  };

  /** 写库要往返一次 Supabase（通常 0.5–2 秒）。这段时间卡片必须自己说「正在写」，
   *  否则用户分不清是点漏了、卡住了，还是真的在等。 */
  const setCardBusy = (targetUrl: string, on: boolean, label = '删除中…') => {
    const card = cardEls.find((item) => (item.getAttribute('href') ?? '') === targetUrl);
    if (!card) return;
    card.classList.toggle('is-busy', on);
    card.dataset.busyLabel = label;
    if (on) card.setAttribute('aria-busy', 'true');
    else card.removeAttribute('aria-busy');
    for (const el of card.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) el.disabled = on;
  };

  /** 常驻的「正在做」提示，操作结束后由调用方关掉 */
  const busyToast = (text: string, detail?: string) => toast(text, { tone: 'busy', timeout: 0, detail });

  /** busy 提示 + 跳秒：请求久了能看出还在动，不是冻住了。返回停止函数 */
  const tickingBusy = (text: string, detail?: string) => {
    const handle = busyToast(text, detail);
    const started = Date.now();
    const id = window.setInterval(
      () => handle.update(`${text} ${Math.round((Date.now() - started) / 1000)} 秒`),
      500,
    );
    return () => {
      window.clearInterval(id);
      handle.close();
    };
  };

  /** 网络请求本身没有超时，卡死时要自己给出终止条件，否则忙碌态会一直挂着 */
  const withTimeout = <T>(task: Promise<T>, ms: number, onTimeout: () => T): Promise<T> => {
    let timer = 0;
    const slow = new Promise<T>((resolve) => {
      timer = window.setTimeout(() => resolve(onTimeout()), ms);
    });
    return Promise.race([task, slow]).finally(() => window.clearTimeout(timer));
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
          const pending = busyToast(`正在恢复 ${total} 条…`, '逐条写库，恢复完会自动刷新');
          try {
            for (const row of rows) {
              pending.update(`正在恢复 ${ok + failed.length + 1}/${total} 条…`, row.title);
              const res = await send('edit', { action: 'add', ...row });
              if (res.ok) ok++;
              else failed.push(`${row.title}：${res.message || '添加失败'}`);
            }
          } finally {
            pending.close();
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

    const pick = document.createElement('input');
    pick.type = 'checkbox';
    pick.className = 'dev-card-pick';
    pick.title = '选中后可批量删除（Shift 连选）';
    pick.setAttribute('aria-label', `选中：${card.querySelector('h2')?.textContent?.trim() ?? '这条资源'}`);
    pick.addEventListener('click', (event) => {
      // 卡片本身是 <a>，但点击目标是 input，链接不会跳转，所以不能 preventDefault：
      // 拦了默认行为，浏览器会在事件后把刚勾上的状态回滚（勾永远打不上）
      event.stopPropagation();
      const url = card.getAttribute('href') ?? '';
      const on = pick.checked;
      if (event.shiftKey && lastPickedUrl) {
        const visible = cardEls.filter((item) => item.isConnected && !item.parentElement?.hidden);
        const from = visible.findIndex((item) => (item.getAttribute('href') ?? '') === lastPickedUrl);
        const to = visible.indexOf(card);
        if (from >= 0 && to >= 0) {
          const [start, end] = from <= to ? [from, to] : [to, from];
          for (let index = start; index <= end; index++) setPick(visible[index], on);
          lastPickedUrl = url;
          return;
        }
      }
      setPick(card, on);
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
    ...(readBox.checked ? { read: false } : {}),
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
    if (!value) {
      urlFeedback.hidden = true;
      return;
    }
    // 请求要往返一次：先摆一句「检查中」，否则提示先空掉、过一会儿才冒出来
    const checking = document.createElement('p');
    checking.className = 'dev-url-checking';
    checking.textContent = '检查中…';
    urlFeedback.append(checking);
    urlFeedback.hidden = false;
    const res = await send<DuplicateReply>('duplicates', { url: value, title: title.value, excludeUrl: editing?.row.url });
    if (seq !== qualitySeq) return;
    urlFeedback.replaceChildren();
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
    heading.textContent = isDraft ? `批量导入 · ${batchIndex + 1}/${batchDrafts.length}` : row ? '编辑资源' : '新增资源';
    url.value = suggestedUrl ?? row?.url ?? '';
    title.value = row?.title ?? '';
    desc.value = row?.desc ?? '';
    added.value = row?.added ?? today();
    readBox.checked = row?.read === false;
    const picked = row?.section?.length ? row.section : pageSection ? [pageSection] : [];
    for (const box of sectionBoxes) box.checked = picked.includes(box.value);
    fillFacets(row?.facets);
    syncPanels();
    editing = row && !isDraft ? { row, initial: { ...currentDraft(), url: row.url } } : null;
    deleteBtn.hidden = isDraft || !row;
    deleteBtn.disabled = false;
    deleteBtn.textContent = '删除';
    deleteBtn.title = '删除这一条';
    batchDiscardBtn.hidden = !isDraft;
    cancelBtn.textContent = isDraft ? '暂停' : '取消';
    saveBtn.disabled = false;
    saveBtn.textContent = isDraft ? (batchIndex === batchDrafts.length - 1 ? '校验并写入整批' : '确认，下一条') : '保存';
    const notes = [suggestedUrl && suggestedUrl !== row?.url ? '已填入建议的新地址，保存前请确认' : ''];
    if (isDraft && row?.hint) notes.push(row.hint);
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
      fillFacets(rules.facets);
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
    fillFacets(merged.facets);

    const parts = [`已生成（${Math.round((res.ms ?? 0) / 1000)} 秒）`];
    if (res.kept?.length && !overwrite) parts.push(`保留了你的${res.kept.join('、')}`);
    if (res.final && res.final !== value) parts.push(`页面跳转到 ${res.final}`);
    if (res.unverified) parts.push(`${res.unverified} 条依据没在正文里找到，已忽略`);
    if (res.warnings?.length) parts.push(`需要核对：${res.warnings.join('；')}`);
    aiMsg.textContent = parts.join(' · ');
    renderEvidence(res.evidence ?? [], Boolean(res.kept?.length) && !overwrite);
  }

  aiBtn.addEventListener('click', () => void aiDraft(false));

  async function remove(targetUrl: string, name?: string, row?: Row) {
    if (!guardBatch('删除其他资源')) return;
    // 写库期间卡片已是 is-busy，连点会被这里挡住，不会重复提交
    if (cardEls.find((item) => (item.getAttribute('href') ?? '') === targetUrl)?.classList.contains('is-busy')) return;

    const label = name ? `「${name}」` : '这条';
    setCardBusy(targetUrl, true, '删除中…');
    // 从编辑弹窗里删时，卡片被弹窗盖着，忙碌态看不到：暂停按钮自己说话
    const inDialog = dlg.open && editing?.row.url === targetUrl;
    if (inDialog) {
      deleteBtn.disabled = true;
      deleteBtn.textContent = '删除中…';
    }
    say(`正在删除${label}…`, 'dirty');
    const stopPending = tickingBusy(`正在删除${label}`, '写库通常一两秒，删完可以撤销');

    const res = await withTimeout(
      send('edit', { action: 'delete', url: targetUrl }),
      25_000,
      () => ({ ok: false, message: '删除请求 25 秒没回应：可能已经写进库了，刷新页面对一下' }) as ApiReply,
    );
    stopPending();

    if (inDialog) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = '删除';
    }

    if (!res.ok) {
      setCardBusy(targetUrl, false);
      say(res.message || '删除失败', 'bad');
      toast(`没删掉${label}`, { tone: 'bad', detail: res.message || '删除失败' });
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
      const restore = saveBtn.textContent || '保存';
      saveBtn.disabled = true;
      saveBtn.textContent = last ? '写入中…' : '校验中…';
      const stopPending = tickingBusy(last ? '正在写入整批…' : '正在校验这一条…', '写库通常一两秒');
      const res = await send('batch-add', last
        ? { rows: [...batchReviewed, draft] }
        : { rows: [draft], dryRun: true });
      stopPending();
      saveBtn.disabled = false;
      saveBtn.textContent = restore;
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

    const payload = editPayload(editing?.initial ?? null, currentDraft());
    const restore = saveBtn.textContent || '保存';
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    const stopPending = tickingBusy(editing ? '正在更新…' : '正在写入…', '写库通常一两秒，存完会自动刷新');
    const res = await send('edit', payload);
    stopPending();
    saveBtn.disabled = false;
    saveBtn.textContent = restore;
    if (!res.ok) {
      fail(res.errors?.length ? res.errors.join('；') : res.message || '保存失败');
      return;
    }
    dlg.close();
    flash(res.message || '已保存', 'ok');
    refresh();
  });

  deleteBtn.addEventListener('click', () => {
    if (editing) void remove(editing.row.url, editing.row.title, editing.row);
  });
  const pauseDraft = () => {
    if (batchActive) batchDrafts[batchIndex] = { ...currentDraft(), hint: batchDrafts[batchIndex].hint };
  };
  cancelBtn.addEventListener('click', () => {
    pauseDraft();
    dlg.close();
  });
  dlg.addEventListener('cancel', pauseDraft);
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
    const stopPending = busyToast(`正在删除 ${entries.length} 条…`, '逐条写库，删完可以撤销');
    const removed: Row[] = [];
    try {
      for (const entry of entries) {
        setCardBusy(entry.row.url, true, '删除中…');
        stopPending.update(`正在删除第 ${removed.length + 1}/${entries.length} 条…`, entry.row.title);
        say(`正在删除 ${removed.length + 1}/${entries.length} 条…`, 'dirty');
        const res = await send('edit', { action: 'delete', url: entry.row.url });
        if (!res.ok) {
          setCardBusy(entry.row.url, false);
          toast(`删除「${entry.row.title}」失败`, { tone: 'bad', detail: res.message });
          break;
        }
        removed.push(entry.row);
        setPick(entry.card, false);
        dropCard(entry.row.url);
        say(`已删除 ${removed.length}/${entries.length}`);
      }
    } finally {
      stopPending.close();
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
    { label: '发布', hint: '校验、补图标、触发远端重建', run: () => publishBtn.click() },
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

  // 四个对话框各自管自己的 DOM 与请求，这里只把共用的收发与工具条状态递过去
  const deps: Deps = { send, say, flash, refresh, guardBatch, openForm: open };
  setupScan(deps);
  setupImport(deps);
  void setupMaintenance(deps).load();
  setupPublish(deps);

  resumeUndo();
  resumeFlash();
}
