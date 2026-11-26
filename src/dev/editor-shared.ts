// dev 编辑层共用的小工具与类型。只被 src/dev/editor*.ts 引用，构建时整块被摇掉。
import type { LinkStatus, Resource } from '../lib/links';
import type { TaskSnapshot } from './task';
import type { ToastTone } from './toast';

export type Row = Resource;
export type Draft = Row & { note?: string };
export type LinkTask = { kind: 'fail' | 'redirect'; reason: string; row: Row; status: LinkStatus };
export type Skipped = { url: string; reason: string; row?: Row };
export type ImportDraft = Draft & { folder?: string; guessed?: boolean };
export type ImportReply = { ok: boolean; message?: string; drafts?: ImportDraft[]; skipped?: Skipped[]; total?: number };
export type ScanGroup = { kind: string; label: string; items: Row[] };
export type DuplicateReply = {
  ok: boolean;
  message?: string;
  cleanup?: { url: string; removed: string[] } | null;
  candidates?: { row: Row; reason: string }[];
};
export type PublishPreview = {
  ok: boolean;
  message?: string;
  added: Row[];
  removed: Row[];
  changed: { before: Row; after: Row }[];
  statusChanged: boolean;
  icons: string[];
};

export type ApiReply = {
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

export type MetaReply = ApiReply & {
  rules?: { section?: string[]; facets?: Record<string, Record<string, unknown>> } | null;
};

export type AiDraftReply = ApiReply & {
  merged?: Row;
  kept?: string[];
  warnings?: string[];
  evidence?: string[];
  unverified?: number;
  final?: string;
  ms?: number;
};

export type BatchMetaReply = { ok: boolean; message?: string; drafts?: Draft[]; skipped?: Skipped[] };

/** init 里造好、按需分发给各对话框的部分：接口收发与工具条状态 */
export type Deps = {
  send: <T extends { ok: boolean } = ApiReply>(name: string, body?: unknown) => Promise<T>;
  say: (text: string, kind?: 'idle' | 'dirty' | 'bad') => void;
  flash: (message: string, tone?: ToastTone) => void;
  refresh: () => void;
  /** 批量导入进行中时挡住其它入口：返回 false 表示已经弹过提示，调用方直接 return */
  guardBatch: (what: string) => boolean;
  openForm: (row: Draft | null, suggestedUrl?: string, isDraft?: boolean) => void;
};

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const externalLink = (label: string, href: string) => {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  return link;
};

export const actionButton = (label: string) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  return button;
};

/** 单次请求没有服务端进度可看，只能把已用秒数刷出来，至少让人知道没卡死 */
export const ticker = (el: HTMLElement, text: (seconds: number) => string) => {
  const started = Date.now();
  el.textContent = text(0);
  const id = window.setInterval(() => el.textContent = text(Math.round((Date.now() - started) / 1000)), 500);
  return () => window.clearInterval(id);
};

/** 任务快照 → 工具条上那一行小字：做到哪一步了 */
export const progressLine = (snap: TaskSnapshot) => {
  const running = snap.steps.find((step) => step.status === 'running');
  const where = running ? running.label : snap.status === 'ok' ? '收尾' : '停止';
  const sub = snap.progress && snap.progress.total > 0 ? ` ${snap.progress.done}/${snap.progress.total}` : '';
  return `${where}${running?.note ? ` · ${running.note}` : sub}`;
};

export const formatValue = (value: unknown) => {
  if (Array.isArray(value)) return value.join('、') || '（空）';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '') || '（空）';
};

/** 破坏性按钮的两步确认：第一次点只把文案改成「确认…」，4 秒内再点才真的执行。
 *  比原生 confirm 顺手（不弹窗、不阻塞），也不会被浏览器自动化直接吞掉。 */
export const twoStep = (btn: HTMLButtonElement, armedText: string, action: () => void | Promise<void>) => {
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
