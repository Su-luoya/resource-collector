// 页面交互：搜索 / 分面筛选 / 键盘导航 / 主题切换。全部原生实现，没有框架。
//
// 首页与分区页共用这一段：轴不再写死，全部从 chip 的 `data-facet` 读出来，
// 卡片上用 `data-facet-<轴>= "值 值"` 记录自己的取值（由 src/components/Catalog.astro 生成）。
//
// 编辑层只在 dev 存在：`import.meta.env.DEV` 在构建时是常量 false，动态 import 整块被摇掉。

const cards = Array.from(document.querySelectorAll<HTMLAnchorElement>('.card'));
const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip[data-facet]'));
const qInput = document.getElementById('q') as HTMLInputElement;
const shown = document.getElementById('shown') as HTMLElement;
const hint = document.getElementById('hint') as HTMLElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const empty = document.getElementById('empty') as HTMLElement;
const themeBtn = document.getElementById('theme') as HTMLButtonElement;

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

const visible = () => cards.filter((card) => !card.hidden);

function apply() {
  const q = query.trim().toLowerCase();
  const active = axes.filter((axis) => picked[axis].size > 0);
  let n = 0;

  for (const card of cards) {
    const okFacets = active.every((axis) => valuesOf(card, axis).some((v) => picked[axis].has(v)));
    const okQuery = !q || (card.dataset.search || '').includes(q);
    const show = okFacets && okQuery;
    card.hidden = !show;
    if (show) n++;
  }

  shown.textContent = String(n);
  empty.hidden = n > 0;

  const filtering = active.length > 0 || q !== '';
  clearBtn.hidden = !filtering;

  const notes: string[] = [];
  if (active.some((axis) => picked[axis].size > 1)) notes.push('同一行内取并集');
  if (active.length > 1) notes.push('不同行取交集');
  hint.textContent = notes.length ? `（${notes.join('，')}）` : '';

  for (const chip of chips) {
    const axis = chip.dataset.facet || '';
    chip.setAttribute('aria-pressed', picked[axis]?.has(chip.dataset.value || '') ? 'true' : 'false');
  }

  // 筛选状态写进 hash：刷新、分享、前进后退都能还原
  const params = new URLSearchParams();
  for (const axis of axes) if (picked[axis].size) params.set(axis, [...picked[axis]].join(','));
  if (q) params.set('q', query.trim());
  const frag = params.toString();
  history.replaceState(null, '', frag ? `#${frag}` : location.pathname + location.search);

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
  query = params.get('q') || '';
  qInput.value = query;
  apply();
}

function reset() {
  for (const axis of axes) picked[axis].clear();
  query = '';
  qInput.value = '';
  apply();
}

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
