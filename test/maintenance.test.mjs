import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRedirectFixes,
  classifyLink,
  confirmFailure,
  maintenanceTasks,
  probeLink,
  redirectFixDecision,
  transientFailure,
} from '../src/lib/link-maintenance.mjs';

const row = (url, title = url) => ({ title, url });
const permanent = (patch = {}) => ({
  status: 'redirect',
  code: 200,
  final: 'https://a.example.com/new',
  redirects: [301, 308],
  ...patch,
});
const response = (status, location) =>
  new Response(null, { status, headers: location ? { location } : {} });

test('纯永久重定向自动更新 URL，并把状态表迁到新 key', () => {
  const rows = [row('https://a.example.com/old', 'A'), row('https://b.example.com/', 'B')];
  const { rows: next, statuses, fixes } = applyRedirectFixes(
    rows,
    {
      'https://a.example.com/old': permanent(),
      'https://b.example.com/': { status: 'ok', code: 200 },
    },
    '2026-08-04',
  );
  assert.equal(next[0].url, 'https://a.example.com/new');
  assert.deepEqual(fixes, [
    { title: 'A', from: 'https://a.example.com/old', to: 'https://a.example.com/new' },
  ]);
  assert.equal(statuses['https://a.example.com/new'].status, 'ok');
  assert.equal(statuses['https://a.example.com/new'].fixedFrom, 'https://a.example.com/old');
  assert.equal(statuses['https://a.example.com/new'].checked, '2026-08-04');
  assert.equal(statuses['https://a.example.com/new'].final, undefined);
  assert.equal(statuses['https://b.example.com/'].status, 'ok');
});

test('临时、跨主机、非 HTTPS、非 2xx 与重复目标都转人工', () => {
  const original = 'https://a.example.com/old';
  const rows = [row(original), row('https://a.example.com/new', '已存在')];
  assert.match(redirectFixDecision(original, permanent({ redirects: [301, 302] }), []).reason, /临时/);
  assert.match(
    redirectFixDecision(original, permanent({ final: 'https://cdn.example.com/new' }), []).reason,
    /跨主机/,
  );
  assert.match(
    redirectFixDecision(original, permanent({ final: 'http://a.example.com/new' }), []).reason,
    /HTTPS/,
  );
  assert.match(redirectFixDecision(original, permanent({ code: 404 }), []).reason, /404/);
  assert.match(redirectFixDecision(original, permanent(), rows).reason, /已存在/);
  assert.equal(redirectFixDecision(original, permanent(), [row(original)]).eligible, true);
});

test('两个旧地址同时跳向同一新地址时，只自动修第一个，不制造重复', () => {
  const rows = [row('https://a.example.com/one'), row('https://a.example.com/two')];
  const result = applyRedirectFixes(
    rows,
    {
      'https://a.example.com/one': permanent(),
      'https://a.example.com/two': permanent(),
    },
    '2026-08-04',
  );
  assert.equal(result.fixes.length, 1);
  assert.equal(result.rows[0].url, 'https://a.example.com/new');
  assert.equal(result.rows[1].url, 'https://a.example.com/two');
  assert.equal(result.statuses['https://a.example.com/two'].status, 'redirect');
});

test('维护待办把 fail 排在 redirect 前，warn 不进入列表', () => {
  const rows = [
    row('https://a.example.com/old', '跳转'),
    row('https://b.example.com/', '拒爬'),
    row('https://c.example.com/', '失效'),
  ];
  const tasks = maintenanceTasks(rows, {
    'https://a.example.com/old': permanent({ redirects: [302] }),
    'https://b.example.com/': { status: 'warn', code: 403 },
    'https://c.example.com/': { status: 'fail', code: 404 },
  });
  assert.deepEqual(tasks.map((task) => task.kind), ['fail', 'redirect']);
  assert.match(tasks[1].reason, /临时/);
});

test('probeLink 逐跳记录重定向，HEAD 被拒时从原地址用 GET 重试', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options.method, options.redirect]);
    if (url === 'https://a.example.com/old') return response(301, '/new');
    if (url === 'https://a.example.com/new' && options.method === 'HEAD') return response(405);
    if (url === 'https://a.example.com/new' && options.method === 'GET') return response(200);
    throw new Error(`unexpected ${url}`);
  };
  const result = await probeLink('https://a.example.com/old', { fetchImpl });
  assert.deepEqual(result, {
    status: 'redirect',
    code: 200,
    final: 'https://a.example.com/new',
    redirects: [301],
  });
  assert.deepEqual(calls.map(([, method]) => method), ['HEAD', 'HEAD', 'GET', 'GET']);
  assert.ok(calls.every(([, , redirect]) => redirect === 'manual'));
});

test('probeLink 转发 303 后改用 GET，网络与状态码分级保持稳定', async () => {
  const methods = [];
  const result = await probeLink('https://a.example.com/old', {
    fetchImpl: async (url, options) => {
      methods.push(options.method);
      return url.endsWith('/old') ? response(303, '/new') : response(200);
    },
  });
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(result.status, 'redirect');
  assert.equal(classifyLink(404), 'fail');
  assert.equal(classifyLink(410), 'fail');
  assert.equal(classifyLink(403), 'warn');
  assert.equal(classifyLink(429), 'warn');
  // 5xx 是站点自己出错，可能只是一时抽风，不能写成「链接失效」
  assert.equal(classifyLink(500), 'warn');
  assert.equal(classifyLink(503), 'warn');
  assert.equal(classifyLink(0, 'ENOTFOUND'), 'fail');
  assert.equal(classifyLink(0, 'AbortError'), 'warn');
});

test('抖动失败先降为 warn，下一轮仍是失败才判 fail', () => {
  assert.equal(confirmFailure({ status: 'fail', code: 404 }, undefined).status, 'fail');
  assert.equal(confirmFailure({ status: 'fail', code: 410 }, { status: 'ok' }).status, 'fail');
  assert.equal(confirmFailure({ status: 'fail', code: 503 }, undefined).status, 'warn');
  assert.equal(confirmFailure({ status: 'fail', code: 503 }, { status: 'ok' }).status, 'warn');
  assert.equal(confirmFailure({ status: 'fail', code: 503 }, { status: 'warn' }).status, 'fail');
  assert.equal(confirmFailure({ status: 'ok', code: 200 }, { status: 'fail' }).status, 'ok');

  assert.equal(transientFailure({ status: 'fail', code: 503 }), true);
  assert.equal(transientFailure({ status: 'warn', code: 429 }), true);
  assert.equal(transientFailure({ status: 'fail', code: 404 }), false);
  assert.equal(transientFailure({ status: 'fail', error: 'ENOTFOUND' }), false);
  assert.equal(transientFailure({ status: 'warn', error: 'AbortError' }), true);
  assert.equal(transientFailure({ status: 'ok', code: 200 }), false);
});

test('probeLink 只对可能是抖动的一次失败重试', async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? response(503) : response(200));
  const retried = await probeLink('https://a.example.com/', { fetchImpl: flaky, retryDelay: 0 });
  assert.equal(retried.status, 'ok');
  assert.equal(calls, 2);

  calls = 0;
  const methods = [];
  const missing = async (url, options) => {
    calls++;
    methods.push(options.method);
    return response(404);
  };
  const once = await probeLink('https://a.example.com/', { fetchImpl: missing, retryDelay: 0 });
  assert.equal(once.status, 'fail');
  // 404 不重试，但会用 GET 复核一次：HEAD 被站点误伤时不会误判
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(calls, 2);
});

test('HEAD 返 404、GET 返 200 的站点不算坏', async () => {
  const methods = [];
  const result = await probeLink('https://hrl.example.com/', {
    fetchImpl: async (url, options) => {
      methods.push(options.method);
      return options.method === 'HEAD' ? response(404) : response(200);
    },
    retryDelay: 0,
  });
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(result.status, 'ok');
  assert.equal(result.code, 200);
});

test('HEAD 与 GET 都是 404 时保留 GET 的结论', async () => {
  const methods = [];
  const result = await probeLink('https://gone.example.com/', {
    fetchImpl: async (url, options) => {
      methods.push(options.method);
      return response(404);
    },
    retryDelay: 0,
  });
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(result.status, 'fail');
  assert.equal(result.code, 404);
});
