// dev 期长任务的进度快照。
//
// 发布、批量抓取这类要跑十几秒的活，端点先返回任务 id，前端按 id 轮询快照；
// 对话框关掉也能从工具条重新接上。这里只管状态机，抓取/提交/推送都在 middleware 里。
//
// 纯 JS、不碰 node 内建也不读时钟以外的东西，`npm test` 直接覆盖。

const LOG_LIMIT = 200;
const KEEP_DONE = 20;

export const createTaskStore = ({ now = () => Date.now(), logLimit = LOG_LIMIT, keep = KEEP_DONE } = {}) => {
  const tasks = new Map();
  let seq = 0;

  const snapshot = (task) => ({
    id: task.id,
    kind: task.kind,
    status: task.status,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    message: task.message,
    steps: task.steps.map((step) => ({ ...step })),
    progress: task.progress ? { ...task.progress } : null,
    log: [...task.log],
    result: task.result ?? null,
  });

  const need = (id) => {
    const task = tasks.get(id);
    if (!task) throw new Error(`没有这个任务：${id}`);
    return task;
  };

  /** 只留最近若干个已完成任务，防止 dev 一直开着时内存里越堆越多 */
  const trim = () => {
    const done = [...tasks.values()]
      .filter((task) => task.status !== 'running')
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    for (const task of done.slice(0, Math.max(0, done.length - keep))) tasks.delete(task.id);
  };

  const append = (task, line) => {
    if (!line) return;
    task.log.push(line);
    if (task.log.length > logLimit) task.log.splice(0, task.log.length - logLimit);
  };

  return {
    start(kind, steps = []) {
      const id = `t${++seq}`;
      const task = {
        id,
        kind,
        status: 'running',
        startedAt: now(),
        finishedAt: null,
        message: '',
        steps: steps.map((step) => ({ id: step.id, label: step.label, status: 'idle', note: '' })),
        progress: null,
        log: [],
        result: null,
      };
      tasks.set(id, task);
      trim();
      return snapshot(task);
    },

    get(id) {
      return tasks.has(id) ? snapshot(tasks.get(id)) : null;
    },

    /** 正在跑的任务：发布按钮靠它判断「已有发布在进行中」 */
    running(kind) {
      return [...tasks.values()]
        .filter((task) => task.status === 'running' && (!kind || task.kind === kind))
        .map(snapshot);
    },

    mark(id, stepId, status, note = '') {
      const task = need(id);
      const step = task.steps.find((item) => item.id === stepId);
      if (!step) throw new Error(`任务 ${id} 没有步骤 ${stepId}`);
      if (status === 'running') {
        // 同一时刻只允许一个步骤在跑，避免上一个忘关而进度条卡住
        for (const other of task.steps) if (other.status === 'running' && other.id !== stepId) other.status = 'ok';
      }
      step.status = status;
      if (note) step.note = note;
      return snapshot(task);
    },

    detail(id, line) {
      const task = need(id);
      append(task, line);
      return snapshot(task);
    },

    /** 子项进度（图标域名、批量 URL）；total=0 时进度条靠步骤本身推进 */
    progress(id, done, total, label = '') {
      const task = need(id);
      if (total > 0) {
        task.progress = { done: Math.max(0, Math.min(done, total)), total, label };
      } else if (typeof done === 'number' && done >= 0 && total === 0) {
        task.progress = { done, total: 0, label };
      }
      return snapshot(task);
    },

    clearProgress(id) {
      const task = need(id);
      task.progress = null;
      return snapshot(task);
    },

    /**
     * @param {string} id
     * @param {{ message?: string, result?: unknown }} [options]
     */
    complete(id, { message = '', result = null } = {}) {
      const task = need(id);
      for (const step of task.steps) {
        if (step.status === 'running') step.status = 'ok';
        else if (step.status === 'idle') step.status = 'skip';
      }
      task.status = 'ok';
      task.finishedAt = now();
      task.message = message;
      task.result = result;
      task.progress = null;
      trim();
      return snapshot(task);
    },

    /**
     * @param {string} id
     * @param {{ message?: string, result?: unknown, stepId?: string }} [options]
     */
    fail(id, { message = '', result = null, stepId = '' } = {}) {
      const task = need(id);
      for (const step of task.steps) {
        if (step.status === 'running') {
          step.status = 'fail';
          if (message) step.note = message;
        } else if (step.status === 'idle') step.status = 'skip';
      }
      if (stepId) {
        const step = task.steps.find((item) => item.id === stepId);
        if (step) {
          step.status = 'fail';
          if (message) step.note = message;
        }
      }
      task.status = 'fail';
      task.finishedAt = now();
      task.message = message;
      task.result = result;
      task.progress = null;
      trim();
      return snapshot(task);
    },
  };
};
