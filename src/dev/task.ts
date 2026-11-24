/**
 * 任务进度的客户端渲染与轮询。
 * 服务端把任务快照存在内存里（`GET api/task?id=` → `{ ok, task }`），这里负责画成
 * 「顶部细进度条 + 步骤清单 + 可展开日志」，并反复去拉最新状态直到结束。
 */

export type StepStatus = 'idle' | 'running' | 'ok' | 'fail' | 'skip';

export type TaskStep = {
  id: string;
  label: string;
  status: StepStatus;
  note?: string;
};

export type TaskProgress = { done: number; total: number; label?: string } | null;

export type TaskSnapshot = {
  id: string;
  kind: string;
  status: 'running' | 'ok' | 'fail';
  startedAt: number;
  finishedAt: number | null;
  message: string;
  steps: TaskStep[];
  progress: TaskProgress;
  log: string[];
  result: unknown;
};

const KIND_LABEL: Record<string, string> = {
  publish: '发布',
  'batch-meta': '批量抓取',
};

/** 任务刚创建、首个快照还没回来时的占位，避免对话框里空一块 */
export const emptyTask = (kind: string): TaskSnapshot => ({
  id: '',
  kind,
  status: 'running',
  startedAt: Date.now(),
  finishedAt: null,
  message: '',
  steps: [],
  progress: null,
  log: [],
  result: null,
});

const MARK: Record<StepStatus, string> = {
  idle: '·',
  running: '▶',
  ok: '✓',
  fail: '✕',
  skip: '–',
};

/** 进度条比例：结束的步骤各算一份，运行中那步按子项 done/total 折算 */
export const taskRatio = (snapshot: TaskSnapshot) => {
  if (snapshot.status === 'ok') return 1;
  const steps = snapshot.steps ?? [];
  if (!steps.length) return 0;
  let done = 0;
  for (const step of steps) {
    if (step.status === 'ok' || step.status === 'fail' || step.status === 'skip') done += 1;
    else if (step.status === 'running') {
      const progress = snapshot.progress;
      if (progress && progress.total > 0) done += Math.min(1, progress.done / progress.total);
    }
  }
  return Math.min(1, done / steps.length);
};

const elapsed = (snapshot: TaskSnapshot) => {
  const end = snapshot.finishedAt ?? Date.now();
  const value = Math.max(0, end - snapshot.startedAt) / 1000;
  return value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s`;
};

/** 已完成的步骤数；运行中的那步不算完成 */
const stepNote = (snapshot: TaskSnapshot, step: TaskStep) => {
  const progress = snapshot.progress;
  if (step.status === 'running' && progress && progress.total > 0) {
    return `${progress.label ?? ''}${progress.label ? ' ' : ''}${progress.done}/${progress.total}`;
  }
  return step.note ?? '';
};

export const renderTask = (box: HTMLElement, snapshot: TaskSnapshot) => {
  const wrap = document.createElement('div');
  wrap.className = 'dev-task';
  wrap.dataset.status = snapshot.status;

  const head = document.createElement('div');
  head.className = 'dev-task-head';
  const name = document.createElement('strong');
  name.textContent = KIND_LABEL[snapshot.kind] ?? snapshot.kind ?? '任务';
  const time = document.createElement('span');
  time.className = 'dev-task-time';
  time.textContent = snapshot.status === 'running' ? elapsed(snapshot) : `用时 ${elapsed(snapshot)}`;
  head.append(name, time);

  const bar = document.createElement('div');
  bar.className = 'dev-task-bar';
  const fill = document.createElement('span');
  fill.style.width = `${Math.round(taskRatio(snapshot) * 100)}%`;
  bar.append(fill);

  wrap.append(head, bar);

  if (snapshot.steps?.length) {
    const list = document.createElement('ol');
    list.className = 'dev-task-steps';
    for (const step of snapshot.steps) {
      const item = document.createElement('li');
      item.className = `is-${step.status}`;
      const mark = document.createElement('span');
      mark.className = 'dev-task-mark';
      mark.textContent = MARK[step.status] ?? '·';
      const label = document.createElement('span');
      label.textContent = step.label;
      item.append(mark, label);
      const note = stepNote(snapshot, step);
      if (note) {
        const small = document.createElement('small');
        small.textContent = note;
        item.append(small);
      }
      list.append(item);
    }
    wrap.append(list);
  }

  if (snapshot.message) {
    const message = document.createElement('p');
    message.className = 'dev-task-message';
    message.textContent = snapshot.message;
    wrap.append(message);
  }

  const log = snapshot.log ?? [];
  if (log.length) {
    const details = document.createElement('details');
    details.className = 'dev-task-log';
    const summary = document.createElement('summary');
    summary.textContent = `实时日志（${log.length}）`;
    const pre = document.createElement('pre');
    pre.textContent = log.slice(-12).join('\n');
    details.append(summary, pre);
    wrap.append(details);
  }

  box.replaceChildren(wrap);
};

const failed = (id: string, message: string): TaskSnapshot => ({
  id,
  kind: '',
  status: 'fail',
  startedAt: Date.now(),
  finishedAt: Date.now(),
  message,
  steps: [],
  progress: null,
  log: [],
  result: null,
});

/** 轮询到任务结束（ok / fail）为止；返回最后一次快照 */
export const pollTask = async (
  id: string,
  options: { interval?: number; onUpdate?: (snapshot: TaskSnapshot) => void } = {},
): Promise<TaskSnapshot> => {
  const interval = options.interval ?? 400;
  const base = document.getElementById('dev')?.dataset.base || '/';
  for (;;) {
    let body: { ok: boolean; task?: TaskSnapshot; message?: string };
    try {
      const response = await fetch(`${base}api/task?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      body = await response.json();
    } catch {
      return failed(id, '连不上本地预览服务，任务可能还在后台跑；稍后点发布按钮可以看回进度');
    }
    if (!body.ok || !body.task) return failed(id, body.message || '读取任务进度失败');
    const snapshot = body.task;
    options.onUpdate?.(snapshot);
    if (snapshot.status !== 'running') return snapshot;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
};
