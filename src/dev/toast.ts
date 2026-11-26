/**
 * 右下角的操作反馈。替代 alert：不打断、可堆叠、能带一个动作按钮（撤销 / 重试）。
 * 只在 dev 编辑层使用，不进构建产物。
 */

export type ToastTone = 'ok' | 'bad' | 'warn' | 'info' | 'busy';

export type ToastHandle = {
  close: () => void;
  /** 改文案：长任务报秒数、逐条报进度都靠它，不用堆一建新的 toast */
  update: (text: string, detail?: string) => void;
};

export type ToastOptions = {
  tone?: ToastTone;
  /** 详情行，失败时放错误原因 */
  detail?: string;
  /** 毫秒；0 表示不自动消失，需要手动关 */
  timeout?: number;
  action?: { label: string; run: () => void | Promise<void> };
};

/** busy 的标记是个转圈，内容由 CSS 画，这里留空 */
const TONE_MARK: Record<ToastTone, string> = { ok: '✓', bad: '✕', warn: '!', info: 'i', busy: '' };
const MAX_TOASTS = 4;
const MAX_HISTORY = 30;

const history: { text: string; tone: ToastTone; at: number }[] = [];

const stack = () => {
  let box = document.getElementById('dev-toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'dev-toasts';
    box.className = 'dev-toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  return box;
};

export const toast = (text: string, options: ToastOptions = {}) => {
  const tone = options.tone ?? 'info';
  const box = stack();
  history.push({ text, tone, at: Date.now() });
  if (history.length > MAX_HISTORY) history.shift();

  const item = document.createElement('div');
  item.className = `dev-toast is-${tone}`;

  const mark = document.createElement('span');
  mark.className = 'dev-toast-mark';
  mark.textContent = TONE_MARK[tone];

  const body = document.createElement('div');
  body.className = 'dev-toast-body';
  const line = document.createElement('p');
  line.className = 'dev-toast-text';
  line.textContent = text;
  body.append(line);
  if (options.detail) {
    const detail = document.createElement('p');
    detail.className = 'dev-toast-detail';
    detail.textContent = options.detail;
    body.append(detail);
  }

  item.append(mark, body);

  let timer = 0;
  const close = () => {
    window.clearTimeout(timer);
    item.classList.add('is-leaving');
    window.setTimeout(() => item.remove(), 160);
  };

  const update = (nextText: string, nextDetail?: string) => {
    line.textContent = nextText;
    history.push({ text: nextText, tone, at: Date.now() });
    if (history.length > MAX_HISTORY) history.shift();
    if (nextDetail === undefined) return;
    let detailEl = body.querySelector('.dev-toast-detail');
    if (!nextDetail) {
      detailEl?.remove();
      return;
    }
    if (!detailEl) {
      detailEl = document.createElement('p');
      detailEl.className = 'dev-toast-detail';
      body.append(detailEl);
    }
    detailEl.textContent = nextDetail;
  };

  if (options.action) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'dev-toast-action';
    action.textContent = options.action.label;
    action.addEventListener('click', async () => {
      action.disabled = true;
      try {
        await options.action?.run();
      } finally {
        close();
      }
    });
    item.append(action);
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'dev-toast-close';
  dismiss.setAttribute('aria-label', '关闭这条提示');
  dismiss.textContent = '✕';
  dismiss.addEventListener('click', close);
  item.append(dismiss);

  box.append(item);
  const items = Array.from(box.children);
  for (const old of items.slice(0, Math.max(0, items.length - MAX_TOASTS))) old.remove();

  // timeout: 0 是真「不自动关」：以前写成 ?? 4000，0 会被当成「立刻关」，忙碌提示一闪就没了
  const ms = options.timeout ?? 4000;
  if (ms > 0) timer = window.setTimeout(close, ms);
  // 鼠标停上去就不自动消失，方便读完错误原因
  item.addEventListener('mouseenter', () => window.clearTimeout(timer));
  return { close, update };
};
