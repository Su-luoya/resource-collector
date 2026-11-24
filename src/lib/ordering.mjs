// 卡片排序规则：构建期（SSR）与浏览器里的重排必须用同一份，否则搜索前后顺序会对不上。
//
// 约束同 link-data.mjs：不 import 任何 node 内建模块，`node --test` 与浏览器都能直接跑。

/** 同日期时按标题，保证两次渲染顺序稳定 */
const byTitle = (a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'zh-Hans-CN');

/** 新的在前 */
export const compareNewest = (a, b) => {
  const added = String(a.added ?? '');
  const other = String(b.added ?? '');
  if (added !== other) return added < other ? 1 : -1;
  return byTitle(a, b);
};

/** 置顶优先，其余同 compareNewest */
export const comparePinned = (a, b) => {
  const pin = a.pin === true ? 0 : 1;
  const other = b.pin === true ? 0 : 1;
  if (pin !== other) return pin - other;
  return compareNewest(a, b);
};

/** 不改原数组；`pinned: false` 用于搜索时按时间序排（置顶不该挡住搜索结果） */
export const sortLinks = (rows, { pinned = true } = {}) =>
  [...rows].sort(pinned ? comparePinned : compareNewest);
