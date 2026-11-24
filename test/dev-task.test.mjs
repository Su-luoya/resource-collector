// src/lib/dev-task.mjs 的单元测试：状态机是前端进度条的唯一依据，边界要钉住。
// 用法：npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStore } from '../src/lib/dev-task.mjs';

const steps = [
  { id: 'check', label: '检查' },
  { id: 'work', label: '干活' },
];

test('任务开始：状态 running，步骤都是 idle，快照与内部状态隔离', () => {
  const store = createTaskStore({ now: () => 1000 });
  const snapshot = store.start('publish', steps);
  assert.equal(snapshot.status, 'running');
  assert.equal(snapshot.startedAt, 1000);
  assert.deepEqual(snapshot.steps.map((step) => step.status), ['idle', 'idle']);

  // 改快照不能改到 store 里的任务
  snapshot.steps[0].status = 'ok';
  assert.equal(store.get(snapshot.id).steps[0].status, 'idle');
});

test('同一时刻只有一个步骤在跑：新步骤 running 会把上一个标成 ok', () => {
  const store = createTaskStore();
  const { id } = store.start('publish', steps);
  store.mark(id, 'check', 'running');
  store.mark(id, 'work', 'running');
  const { steps: current } = store.get(id);
  assert.equal(current[0].status, 'ok');
  assert.equal(current[1].status, 'running');
});

test('子项进度会被夹在 0..total，label 一起进快照', () => {
  const store = createTaskStore();
  const { id } = store.start('publish', steps);
  store.progress(id, 5, 3, '图标域名');
  assert.deepEqual(store.get(id).progress, { done: 3, total: 3, label: '图标域名' });
  store.progress(id, -2, 10, '页面');
  assert.equal(store.get(id).progress.done, 0);
  store.clearProgress(id);
  assert.equal(store.get(id).progress, null);
});

test('完成：跑着的步骤收尾为 ok，没轮到的标 skip，结果原样带出', () => {
  const store = createTaskStore({ now: () => 2000 });
  const { id } = store.start('publish', steps);
  store.mark(id, 'check', 'ok', 'main');
  const done = store.complete(id, { message: '已推送', result: { ok: true, hash: 'abc1234' } });
  assert.equal(done.status, 'ok');
  assert.equal(done.finishedAt, 2000);
  assert.deepEqual(done.steps.map((step) => step.status), ['ok', 'skip']);
  assert.deepEqual(done.result, { ok: true, hash: 'abc1234' });
  assert.equal(done.progress, null);
});

test('失败：指到具体步骤，其它步骤不再装成成功', () => {
  const store = createTaskStore();
  const { id } = store.start('publish', steps);
  store.mark(id, 'work', 'running');
  const failed = store.fail(id, { stepId: 'work', message: '推送被拒', result: { ok: false } });
  assert.equal(failed.status, 'fail');
  assert.equal(failed.message, '推送被拒');
  assert.equal(failed.steps[1].status, 'fail');
  assert.equal(failed.steps[1].note, '推送被拒');
  assert.equal(failed.steps[0].status, 'skip');
});

test('日志有上限，只留最新的若干行', () => {
  const store = createTaskStore({ logLimit: 3 });
  const { id } = store.start('publish', steps);
  for (const line of ['a', 'b', 'c', 'd']) store.detail(id, line);
  assert.deepEqual(store.get(id).log, ['b', 'c', 'd']);
});

test('running(kind) 只返回还在跑的任务；没有 id 就是 null', () => {
  const store = createTaskStore();
  const first = store.start('publish', steps);
  store.start('batch-meta', steps);
  assert.deepEqual(store.running('publish').map((task) => task.id), [first.id]);
  assert.equal(store.running().length, 2);
  store.complete(first.id, {});
  assert.deepEqual(store.running('publish'), []);
  assert.equal(store.get('nope'), null);
});

test('已完成任务只留最近若干个，避免 dev 一直开着越堆越多', () => {
  const store = createTaskStore({ keep: 2 });
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(store.start('publish', steps).id);
  for (const id of ids) store.complete(id, {});
  const left = ids.filter((id) => store.get(id) !== null);
  assert.deepEqual(left, ids.slice(-2));
});
