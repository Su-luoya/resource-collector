// 首页交互：搜索 / 分面筛选 / 键盘导航 / 主题切换。全部原生实现，没有框架。
//
// 从 src/pages/index.astro 里挪出来的原因：markup 归 markup，行为归行为；
// 这个文件能单独读、单独测（DOM 依赖集中在 selectors 一段）。
//
// 编辑层只在 dev 存在：`import.meta.env.DEV` 在构建时是常量 false，动态 import 整块被摇掉。

type Axis = 'type' | 'topic';

const cards = Array.from(document.querySelectorAll<HTMLAnchorElement>('.card'));
const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip[data-facet]'));
const qInput = document.getElementById('q') as HTMLInputElement;
const shown = document.getElementById('shown') as HTMLElement;
const hint = document.getElementById('hint') as HTMLElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const empty = document.getElementById('empty') as HTMLElement;
const themeBtn = document.getElementById('theme') as HTMLButtonElement;

/** 两条轴各一个集合：同轴内取并集（OR），跨轴取交集（AND） */
const picked: Record<Axis, Set<string>> = { type: new Set<string>(), topic: new Set<string>() };
let query = '';
let activeIndex = -1;

/** 词表里真实存在的取值，用来忽略过期的 URL hash（改名后的旧链接不该把页面筛空） */
const known: Record<Axis, Set<string>> = { type: new Set<string>(), topic: new Set<string>() };
for (const chip of chips) known[chip.dataset.facet as Axis]?.add(chip.dataset.value || '');

const axisOf = (chip: HTMLButtonElement) => chip.dataset.facet as Axis;

const visible = () => cards.filter((card) => !card.hidden);

function apply() {
  const q = query.trim().toLowerCase();
  const { type: ts, topic: ks } = picked;
  let n = 0;

  for (const card of cards) {
    const okType = ts.size === 0 || ts.has(card.dataset.type || '');
    const topics = (card.dataset.topics || '').split(' ');
    const okTopic = ks.size === 0 || topics.some((t) => ks.has(t));
    const okQuery = !q || (card.dataset.search || '').includes(q);
    const show = okType && okTopic && okQuery;
    card.hidden = !show;
    if (show) n++;
  }

  shown.textContent = String(n);
  empty.hidden = n > 0;

  const filtering = ts.size + ks.size > 0 || q !== '';
  clearBtn.hidden = !filtering;

  const notes: string[] = [];
  if (ts.size > 1 || ks.size > 1) notes.push('同一行内取并集');
  if (ts.size > 0 && ks.size > 0) notes.push('类型与主题取交集');
  hint.textContent = notes.length ? `（${notes.join('，')}）` : '';

  for (const chip of chips) {
    chip.setAttribute('aria-pressed', picked[axisOf(chip)].has(chip.dataset.value || '') ? 'true' : 'false');
  }

  // 筛选状态写进 hash：刷新、分享、前进后退都能还原
  const params = new URLSearchParams();
  if (ts.size) params.set('type', [...ts].join(','));
  if (ks.size) params.set('topic', [...ks].join(','));
  if (q) params.set('q', query.trim());
  const frag = params.toString();
  history.replaceState(null, '', frag ? `#${frag}` : location.pathname + location.search);

  activeIndex = -1;
  cards.forEach((card) => card.classList.remove('is-active'));
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const read = (axis: Axis) =>
    new Set((params.get(axis) || '').split(',').filter((id) => id && known[axis].has(id)));

  picked.type = read('type');
  picked.topic = read('topic');
  query = params.get('q') || '';
  qInput.value = query;
  apply();
}

function reset() {
  picked.type.clear();
  picked.topic.clear();
  query = '';
  qInput.value = '';
  apply();
}

for (const chip of chips) {
  chip.addEventListener('click', () => {
    const axis = axisOf(chip);
    const value = chip.dataset.value || '';
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
