// dev 端点里的长任务（发布、批量抓取）现在是「先返回 id，再轮询快照」。
// 测试里通常只关心结果，所以统一在这里等任务跑完；需要看中间态时传 onSnapshot。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const start = async (port, name, body = {}) =>
  (
    await fetch(`http://127.0.0.1:${port}/api/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();

const snapshotOf = async (port, id) => {
  const state = await (await fetch(`http://127.0.0.1:${port}/api/task?id=${id}`)).json();
  if (!state.ok) throw new Error(`读取任务失败：${state.message}`);
  return state.task;
};

/** 只启动任务，返回端点响应（{ ok, id } 或错误） */
export const startTask = (port, name, body) => start(port, name, body);

/** 轮询到结束，返回任务结果（形如原来的同步响应体） */
export const runTask = async (port, name, body = {}, { timeout = 20_000, onSnapshot } = {}) => {
  const started = await start(port, name, body);
  if (!started.ok) return started;
  if (!started.id) throw new Error(`${name} 没有返回任务 id：${JSON.stringify(started)}`);

  const deadline = Date.now() + timeout;
  for (;;) {
    const task = await snapshotOf(port, started.id);
    onSnapshot?.(task);
    if (task.status !== 'running') {
      return task.result ?? { ok: task.status === 'ok', message: task.message };
    }
    if (Date.now() > deadline) throw new Error(`${name} 任务没有在 ${timeout}ms 内结束`);
    await sleep(40);
  }
};
