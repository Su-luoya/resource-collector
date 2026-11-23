// dev 编辑层：只在 `npm run dev` 里被动态 import，构建时整块被摇掉。
// 端点见 src/middleware.ts；数据层的序列化与校验在 src/lib/link-data.mjs。
import './editor.css';
import type { Resource } from '../lib/links';

type Row = Resource;

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
  const type = $<HTMLSelectElement>('f-type');
  const added = $<HTMLInputElement>('f-added');
  const fetchBtn = $<HTMLButtonElement>('f-fetch');
  const fetchMsg = $<HTMLSpanElement>('f-fetch-msg');
  const errBox = $<HTMLParagraphElement>('f-err');
  const saveBtn = $<HTMLButtonElement>('f-save');
  const deleteBtn = $<HTMLButtonElement>('f-delete');
  const cancelBtn = $<HTMLButtonElement>('f-cancel');
  const heading = $<HTMLHeadingElement>('dev-heading');
  const addBtn = $<HTMLButtonElement>('dev-add');
  const publishBtn = $<HTMLButtonElement>('dev-publish');
  const stateEl = $<HTMLSpanElement>('dev-state');
  const topics = Array.from(dlg.querySelectorAll<HTMLInputElement>('input[data-topic]'));

  let editing: string | null = null;

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const say = (text: string, kind: 'idle' | 'dirty' | 'bad' = 'idle') => {
    stateEl.textContent = text;
    stateEl.dataset.state = kind;
  };

  const fail = (text: string) => {
    errBox.hidden = !text;
    errBox.textContent = text;
  };

  async function send(name: string, body?: unknown) {
    const res = await fetch(api(name), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }))) as {
      ok: boolean;
      message?: string;
      reason?: string;
      errors?: string[];
      title?: string;
      desc?: string;
      note?: string;
      dirty?: boolean;
      added?: number;
      removed?: number;
      changed?: number;
      branch?: string;
      head?: string;
      warns?: string[];
    };
  }

  /** 写盘后 Vite 会立即让 links.yaml 的模块失效（实测 150ms 内新页面已是新数据），稍等整页刷新即可 */
  const refresh = () => setTimeout(() => location.reload(), 150);

  // ---- 卡片上的编辑/删除按钮 ----
  const rowOf = (card: Element): Row => {
    const el = card as HTMLElement;
    return {
      title: card.querySelector('h2')?.textContent?.trim() ?? '',
      url: card.getAttribute('href') ?? '',
      type: el.dataset.type ?? '',
      topics: (el.dataset.topics ?? '').split(' ').filter(Boolean),
      desc: card.querySelector('.desc')?.textContent?.trim() ?? '',
      added: el.dataset.added ?? '',
    };
  };

  for (const card of Array.from(document.querySelectorAll('.card'))) {
    const el = card as HTMLElement;
    el.style.position = 'relative';

    const box = document.createElement('span');
    box.className = 'dev-card-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = '✎';
    edit.title = '编辑这一条';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '✕';
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
      void remove(row.url, row.title);
    });

    box.append(edit, del);
    card.append(box);
  }

  // ---- 表单 ----
  function open(row: Row | null) {
    editing = row?.url ?? null;
    heading.textContent = row ? '编辑资源' : '新增资源';
    url.value = row?.url ?? '';
    url.readOnly = Boolean(row);
    title.value = row?.title ?? '';
    desc.value = row?.desc ?? '';
    type.value = row?.type ?? 'code';
    added.value = row?.added ?? today();
    for (const box of topics) box.checked = (row?.topics ?? []).includes(box.value);
    deleteBtn.hidden = !row;
    fetchMsg.textContent = '';
    fail('');
    dlg.showModal();
    (url.readOnly ? title : url).focus();
  }

  async function fetchMeta() {
    const value = url.value.trim();
    if (!value) {
      fetchMsg.textContent = '先填 URL';
      return;
    }
    fetchBtn.disabled = true;
    fetchMsg.textContent = '抓取中…';
    const res = await send('meta', { url: value });
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
    fetchMsg.textContent = [filled.length ? `已填入${filled.join('、')}` : '抓到内容了，但你已填过，保持不变', res.note]
      .filter(Boolean)
      .join(' · ');
  }

  async function remove(targetUrl: string, name?: string) {
    if (!confirm(`确定删除？\n${name || targetUrl}`)) return;
    const res = await send('edit', { action: 'delete', url: targetUrl });
    if (!res.ok) {
      say(res.message || '删除失败', 'bad');
      return;
    }
    dlg.close();
    say(res.message || '已删除');
    refresh();
  }

  saveBtn.addEventListener('click', async () => {
    const payload = {
      action: editing ? 'update' : 'add',
      url: url.value.trim(),
      title: title.value,
      desc: desc.value,
      type: type.value,
      added: added.value,
      topics: topics.filter((box) => box.checked).map((box) => box.value),
    };
    if (!payload.url) return fail('URL 不能为空');
    saveBtn.disabled = true;
    const res = await send('edit', payload);
    saveBtn.disabled = false;
    if (!res.ok) {
      fail(res.errors?.length ? res.errors.join('；') : res.message || '保存失败');
      return;
    }
    dlg.close();
    say(res.message || '已保存');
    refresh();
  });

  deleteBtn.addEventListener('click', () => {
    if (editing) void remove(editing, title.value);
  });
  cancelBtn.addEventListener('click', () => dlg.close());
  fetchBtn.addEventListener('click', () => void fetchMeta());

  // 回车不提交原生表单（否则会带 query 重载页面）
  dlg.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveBtn.click();
  });

  // 新增时填完 URL 就自动抓一次，省一步点击
  url.addEventListener('change', () => {
    if (!editing && !title.value.trim()) void fetchMeta();
  });

  addBtn.addEventListener('click', () => open(null));

  // ---- 发布 ----
  publishBtn.addEventListener('click', async () => {
    const status = await send('status');
    if (!status.ok) {
      say(status.message || '读不到状态', 'bad');
      return;
    }
    const count = (status.added ?? 0) + (status.removed ?? 0) + (status.changed ?? 0);
    if (!status.dirty) {
      say(`没有待发布的改动（${status.head}）`);
      return;
    }
    const summary = [`新增 ${status.added ?? 0}`, `删除 ${status.removed ?? 0}`, `修改 ${status.changed ?? 0}`].join(' / ');
    if (!confirm(`发布到 ${status.branch}？\n${summary}\n\n会依次：抓缺失图标 → 校验 → commit → push`)) return;

    publishBtn.disabled = true;
    say('发布中…');
    const res = await send('publish', {});
    publishBtn.disabled = false;
    if (!res.ok) {
      say(res.message || '发布失败', 'bad');
      alert(res.errors?.length ? `${res.message}\n\n${res.errors.join('\n')}` : res.message || '发布失败');
      return;
    }
    say(res.message || '已推送', res.warns?.length ? 'dirty' : 'idle');
    if (count) alert([`已发布：${res.message}`, ...(res.warns ?? [])].join('\n\n'));
  });

  // ---- 初始状态 ----
  void (async () => {
    const status = await send('status');
    if (!status.ok) return;
    if (status.dirty) {
      const { added = 0, removed = 0, changed = 0 } = status;
      say(
        added + removed + changed > 0
          ? `未发布：+${added} −${removed} ~${changed}`
          : '未发布：数据文件有改动（图标等）',
        'dirty',
      );
    } else {
      say(`已同步 ${status.branch}@${status.head}`);
    }
  })();
}
