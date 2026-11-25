// 页面交互：搜索 / 分面筛选 / 键盘导航 / 主题切换。全部原生实现，没有框架。
//
// 首页与分区页共用这一段：轴不再写死，全部从 chip 的 `data-facet` 读出来，
// 卡片上用 `data-facet-<轴>= "值 值"` 记录自己的取值（由 src/components/Catalog.astro 生成）。
//
// 编辑层只在 dev 存在：`import.meta.env.DEV` 在构建时是常量 false，动态 import 整块被摇掉。

import { markdownItem } from './markdown';
import { highlightPattern, highlightPieces, matchesQuery, parseQuery } from './search';
import { compareNewest, comparePinned } from '../lib/ordering.mjs';

const cards = Array.from(document.querySelectorAll<HTMLAnchorElement>('.card'));
const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip[data-facet]'));
/** 分区导航：记住原始地址，apply 时把当前筛选拼成 hash 带上，跨页不丢状态 */
const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.section-link'));
for (const link of navLinks) link.dataset.base = link.getAttribute('href') || '';
const qInput = document.getElementById('q') as HTMLInputElement;
const shown = document.getElementById('shown') as HTMLElement;
const hint = document.getElementById('hint') as HTMLElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const copyBtn = document.getElementById('copy') as HTMLButtonElement;
const copyStatus = document.getElementById('copy-status') as HTMLElement;
const copyFallback = document.getElementById('copy-fallback') as HTMLTextAreaElement;
const empty = document.getElementById('empty') as HTMLElement;
const themeBtn = document.getElementById('theme') as HTMLButtonElement;
const recentBar = document.getElementById('recent') as HTMLElement;
const recentToggle = document.getElementById('recent-toggle') as HTMLButtonElement;

/** 最近 7 天：用本地日期拼 YYYY-MM-DD，avoid toISOString 的 UTC 偏一天 */
const RECENT_DAYS = 7;
const recentCutoff = (() => {
  const day = new Date();
  day.setDate(day.getDate() - RECENT_DAYS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
})();
const recentTotal = cards.filter((card) => (card.dataset.added || '') >= recentCutoff).length;
let recentOnly = false;

/** 轴 = 页面渲染出来的 facet 行；首页只有 section 一条，分区页是该分区的各条轴 */
const axes = [...new Set(chips.map((chip) => chip.dataset.facet || ''))].filter(Boolean);

/** 每条轴一个集合：同轴内取并集（OR），跨轴取交集（AND） */
const picked: Record<string, Set<string>> = Object.fromEntries(axes.map((axis) => [axis, new Set<string>()]));
let query = '';
let activeIndex = -1;

/** 词表里真实存在的取值，用来忽略过期的 URL hash（改名后的旧链接不该把页面筛空） */
const known: Record<string, Set<string>> = Object.fromEntries(axes.map((axis) => [axis, new Set<string>()]));
for (const chip of chips) known[chip.dataset.facet || '']?.add(chip.dataset.value || '');

const valuesOf = (card: HTMLAnchorElement, axis: string) =>
  (card.getAttribute(`data-facet-${axis}`) || '').split(' ').filter(Boolean);

/** 卡片外面包了一层 .card-slot，隐藏与重排都作用在它上面：判断可见性必须看外层，看 .card 永远是可见的 */
const slotOf = (card: HTMLAnchorElement) => card.parentElement ?? card;

const visible = () => cards.filter((card) => !slotOf(card).hidden);

/** 标题与简介的原文：高亮要从原文重建，不能拿已经插了 <mark> 的 textContent 当源 */
const hlEls = cards.flatMap((card) => Array.from(card.querySelectorAll<HTMLElement>('[data-hl]')));
const hlText = new Map<HTMLElement, string>(hlEls.map((el) => [el, el.textContent || '']));
const grid = document.getElementById('grid') as HTMLElement | null;

/** 高亮词：只在正文里出现过的片段包 <mark>，其余原样 */
function paint(pattern: RegExp | null) {
  for (const [el, text] of hlText) {
    if (!pattern) {
      if (el.childNodes.length > 1 || el.textContent !== text) el.textContent = text;
      continue;
    }
    const pieces = highlightPieces(text, pattern);
    const only = pieces.length === 1 && !pieces[0].hit;
    if (only) {
      if (el.childNodes.length > 1) el.textContent = text;
      continue;
    }
    el.replaceChildren(
      ...pieces.map((piece) => {
        if (!piece.hit) return document.createTextNode(piece.text);
        const mark = document.createElement('mark');
        mark.textContent = piece.text;
        return mark;
      }),
    );
  }
}

/**
 * 排序：空闲时置顶优先，搜索时只用时间序（置顶不该挡住搜索结果）。
 * 每次从原始数组重算，避免反复重排后顺序漂移。
 */
function reorder(idle: boolean) {
  if (!grid) return;
  const ordered = [...cards].sort((a, b) => {
    const left = { pin: a.dataset.pin === '1', added: a.dataset.added || '', title: hlText.get(a.querySelector<HTMLElement>('h2')!) || '' };
    const right = { pin: b.dataset.pin === '1', added: b.dataset.added || '', title: hlText.get(b.querySelector<HTMLElement>('h2')!) || '' };
    return idle ? comparePinned(left, right) : compareNewest(left, right);
  });
  // 已经排好了就不动 DOM：比较对象是网格里现在的顺序，不是加载时那份静态数组
  if (ordered.every((card, index) => grid.children[index] === slotOf(card))) return;
  // 卡片外面包了一层 .card-slot（为了放「详情」链接，不能套在 <a> 里）：重排要搬整块
  for (const card of ordered) grid.append(slotOf(card));
}

function apply() {
  const q = query.trim();
  const parsed = parseQuery(q);
  const active = axes.filter((axis) => picked[axis].size > 0);

  const matchCard = (card: HTMLAnchorElement) =>
    matchesQuery(parsed, {
      haystack: card.dataset.search || '',
      sections: (card.dataset.section || '').split(' ').filter(Boolean),
      host: card.dataset.host || '',
      pinned: card.dataset.pin === '1',
      unread: card.dataset.read === '1',
      hasNote: card.dataset.note === '1',
      status: card.dataset.status || '',
    });
  let n = 0;

  for (const card of cards) {
    const okFacets = active.every((axis) => valuesOf(card, axis).some((v) => picked[axis].has(v)));
    const okRecent = !recentOnly || (card.dataset.added || '') >= recentCutoff;
    const show = okFacets && okRecent && matchCard(card);
    // 卡片外面包了一层 .card-slot，隐藏要作用在外层，否则网格里留空位
    slotOf(card).hidden = !show;
    if (show) n++;
  }

  reorder(q === '');
  paint(highlightPattern(parsed.text));

  shown.textContent = String(n);
  empty.hidden = n > 0;
  copyBtn.hidden = n === 0;
  copyBtn.textContent = `复制这 ${n} 条`;
  copyStatus.textContent = '';
  copyFallback.hidden = true;

  recentBar.hidden = recentTotal === 0;
  recentToggle.innerHTML = recentOnly
    ? `正在只看最近 ${RECENT_DAYS} 天的 <strong>${recentTotal}</strong> 条 · 显示全部`
    : `最近 ${RECENT_DAYS} 天新增 <strong>${recentTotal}</strong> 条 · 只看这些`;
  recentToggle.setAttribute('aria-pressed', recentOnly ? 'true' : 'false');

  const filtering = active.length > 0 || q !== '' || recentOnly;
  clearBtn.hidden = !filtering;

  const notes: string[] = [];
  if (active.some((axis) => picked[axis].size > 1)) notes.push('同一行内取并集');
  if (active.length > 1) notes.push('不同行取交集');
  if (parsed.unknownFlags.length) notes.push(`不认识 is:${parsed.unknownFlags.join(' / is:')}，可用 is:pinned / is:unread / is:read / is:note / is:fail / is:warn`);
  hint.textContent = notes.length ? `（${notes.join('，')}）` : '';

  for (const chip of chips) {
    const axis = chip.dataset.facet || '';
    chip.setAttribute('aria-pressed', picked[axis]?.has(chip.dataset.value || '') ? 'true' : 'false');
  }

  // 筛选状态写进 hash：刷新、分享、前进后退都能还原
  const params = new URLSearchParams();
  for (const axis of axes) if (picked[axis].size) params.set(axis, [...picked[axis]].join(','));
  if (q) params.set('q', q);
  const frag = params.toString();
  history.replaceState(null, '', frag ? `#${frag}` : location.pathname + location.search);

  // 左侧分区导航带上同一份筛选：去别的分区看看，不用重新勾一遍
  for (const link of navLinks) {
    const href = link.dataset.base || '';
    link.setAttribute('href', frag && href ? `${href}#${frag}` : href);
  }

  activeIndex = -1;
  cards.forEach((card) => card.classList.remove('is-active'));
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const axis of axes) {
    picked[axis] = new Set(
      (params.get(axis) || '').split(',').filter((id) => id && known[axis].has(id)),
    );
  }
  query = params.get('q') || new URLSearchParams(location.search).get('q') || '';
  qInput.value = query;
  apply();
}

function reset() {
  for (const axis of axes) picked[axis].clear();
  query = '';
  recentOnly = false;
  qInput.value = '';
  apply();
}

recentToggle.addEventListener('click', () => {
  recentOnly = !recentOnly;
  apply();
});

for (const chip of chips) {
  chip.addEventListener('click', () => {
    const axis = chip.dataset.facet || '';
    const value = chip.dataset.value || '';
    if (!axes.includes(axis)) return;
    if (picked[axis].has(value)) picked[axis].delete(value);
    else picked[axis].add(value);
    apply();
  });
}

qInput.addEventListener('input', () => {
  query = qInput.value;
  apply();
});

copyBtn.addEventListener('click', async () => {
  const list = visible();
  if (!list.length) return;
  const view = location.hash;
  const text = list.map((card) => markdownItem(
    card.querySelector('h2')!.textContent,
    card.getAttribute('href')!,
    card.querySelector('.desc')!.textContent,
  )).join('\n');

  let copied = true;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    copied = false;
  }
  if (location.hash !== view) return; // 等待剪贴板权限时，筛选结果可能已经变了。
  copyFallback.hidden = copied;
  copyStatus.textContent = copied ? `已复制 ${list.length} 条（Markdown）` : '无法自动复制，请手动复制下方已选中的清单。';
  if (!copied) {
    copyFallback.value = text;
    copyFallback.focus();
    copyFallback.select();
  }
});

clearBtn.addEventListener('click', reset);
window.addEventListener('hashchange', readHash);

// ---- 键盘：/ 聚焦搜索，j/k 或上下键移动，Enter 打开，Esc 清空 ----
function move(delta: number) {
  const list = visible();
  if (!list.length) return;
  activeIndex = (activeIndex + delta + list.length) % list.length;
  cards.forEach((card) => card.classList.remove('is-active'));
  const target = list[activeIndex];
  target.classList.add('is-active');
  target.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (event) => {
  const typing =
    event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);

  if (event.key === '/' && !typing) {
    event.preventDefault();
    qInput.focus();
    qInput.select();
    return;
  }
  if (event.key === 'Escape') {
    if (typing) qInput.blur();
    else reset();
    return;
  }
  if (typing) return;

  if (event.key === 'ArrowDown' || event.key === 'j') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp' || event.key === 'k') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter' && activeIndex >= 0) {
    if (event.target instanceof Element && event.target.closest('button, a')) return;
    visible()[activeIndex]?.click();
  }
});

// ---- 主题 ----
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* 隐私模式下写不进去，忽略 */
  }
});

readHash();

// 编辑层只在 dev 加载：构建时 import.meta.env.DEV 是常量 false，这个分支连同动态 import 一起被摇掉
if (import.meta.env.DEV) void import('../dev/editor');
