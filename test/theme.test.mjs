// 主题清单与 global.css 的 [data-theme] 块必须一一对应：菜单里点得到、样式里画得出。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { THEME_IDS } from '../src/lib/theme.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'src/styles/global.css'), 'utf8');

/** 取从 header 开始到它自己的右花括号为止的一段，避免跨块读串。 */
function block(header) {
  const start = css.indexOf(header);
  assert.ok(start >= 0, `找不到 ${header}`);
  return css.slice(start, css.indexOf('}', start));
}

function vars(text) {
  return new Map([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
}

const base = vars(block(':root {'));

test('每套主题都有配色块，也没有多余块', () => {
  const defined = [...css.matchAll(/\[data-theme='([\w-]+)'\]\s*\{/g)].map((match) => match[1]);
  assert.deepEqual(defined, THEME_IDS);
});

test('每套主题都拿得到卡片要用的全部颜色', () => {
  // 主题块可以只写自己改的那几项（继承 :root），但合并后这 7 个必须齐 ——
  // 漏一个就是 accent 失效、卡片透明这类看不出来的坏样式。
  const needed = ['--bg', '--bg-elev', '--bg-soft', '--fg', '--fg-muted', '--line', '--accent'];
  for (const id of THEME_IDS) {
    const merged = new Map([...base, ...vars(block(`[data-theme='${id}'] {`))]);
    for (const key of needed) assert.ok(merged.get(key), `主题 ${id} 缺 ${key}`);
  }
});

/** 深色主题的判定只有一处来源：global.css 里自己写了 color-scheme: dark 的块。 */
const darkIds = THEME_IDS.filter((id) => /color-scheme:\s*dark/.test(block(`[data-theme='${id}'] {`)));

test('dev 勾选框的深色名单跟上配色清单', () => {
  const devCss = readFileSync(resolve(root, 'src/dev/editor.css'), 'utf8');
  const rule = devCss.match(/:is\(([^)]*)\)\s*\.dev-card-pick:checked/);
  assert.ok(rule, 'editor.css 里找不到勾选框的 :is(...) 规则');
  const listed = [...rule[1].matchAll(/\[data-theme='([\w-]+)'\]/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, [...darkIds].sort());
});

test('首帧脚本只认清单里的主题名', () => {
  // 与 filter.ts 的回落必须一致，否则首帧一套、脚本跑完一套，会闪一下。
  const base = readFileSync(resolve(root, 'src/layouts/Base.astro'), 'utf8');
  assert.match(base, /themeIds\.includes\(saved\)/);
});
