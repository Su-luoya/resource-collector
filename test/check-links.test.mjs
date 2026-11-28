import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { writeCache } from '../src/lib/cloud-sync.mjs';
import { startFakeCloud } from './helpers/cloud.mjs';

test('周检只改地址：不覆盖新笔记或已被占用的目标，部分写入时仍通知重建', async (t) => {
  const scratch = resolve('.scratch');
  mkdirSync(scratch, { recursive: true });
  const cwd = mkdtempSync(join(scratch, 'weekly-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const row = (title) => ({ title, url: 'https://weekly.example/' + title, section: ['tools'], facets: { tools: { kind: 'tool' } }, desc: title, added: '2026-01-01' });
  const [one, two] = ['one', 'two'].map(row);
  const taken = row('two-new');
  const cloud = await startFakeCloud({ links: [{ ...one, note: '云端刚改的笔记' }, two, taken] });
  t.after(() => cloud.close());
  cloud.use();
  const output = join(cwd, 'output');
  writeCache({ links: [one, two], status: {}, icons: {} }, join(cwd, '.cache/links.json'));
  writeFileSync(join(cwd, 'probe.mjs'),
    `const real = globalThis.fetch;
     globalThis.fetch = (url, init) => {
       const u = new URL(url);
       if (u.origin === process.env.SUPABASE_URL) return real(url, init);
       if (u.hostname !== 'weekly.example') throw Error('unexpected URL: ' + u);
       return new Response(null, u.pathname.endsWith('-new') ? { status: 200 } : { status: 301, headers: { location: u.pathname + '-new' } });
     };`);
  const run = () => promisify(execFile)(process.execPath, ['--import', './probe.mjs', resolve('scripts/check-links.mjs')], {
    cwd, env: { ...process.env, GITHUB_OUTPUT: output },
  });
  await assert.rejects(run, (err) => err.code === 1 && err.stdout.includes('自动修复 1') && err.stderr.includes('duplicate url'));
  assert.equal(cloud.tables.links.get(one.url + '-new').note, '云端刚改的笔记');
  assert.ok(cloud.tables.links.has(two.url));
  assert.deepEqual(cloud.tables.links.get(taken.url), taken);
  assert.ok(!cloud.tables.link_status.has(taken.url));
  assert.equal(readFileSync(output, 'utf8').trim(), 'rebuild=true');
  // 刷新后的缓存知道目标已经被占用；记录人工处理项，之后只有检查日期的变化不重建。
  await run();
  await run();
  assert.equal(readFileSync(output, 'utf8').trim().split('\n').at(-1), 'rebuild=false');
});
