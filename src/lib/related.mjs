// 详情页的「相关条目」：同站点权重最高，其次共享分类，最后按时间。
// 纯函数，不 import node 内建模块，`node --test` 能直接跑。
import { hostKey } from './link-data.mjs';
import { compareNewest } from './ordering.mjs';

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/** 分类路径集合：`分区:轴:取值`。共享得越多越像。 */
export const facetKeys = (link) => {
  const keys = new Set();
  for (const [sid, axes] of Object.entries(link.facets ?? {})) {
    for (const [fid, value] of Object.entries(axes ?? {})) {
      for (const id of asList(value)) keys.add(`${sid}:${fid}:${id}`);
    }
  }
  return keys;
};

const sharedCount = (a, b) => {
  let n = 0;
  for (const key of a) if (b.has(key)) n++;
  return n;
};

/** 同站点的其它条目（不含自己），最新在前 */
export const sameHostOf = (link, rows) =>
  rows.filter((row) => row.url !== link.url && hostKey(row.url) === hostKey(link.url)).sort(compareNewest);

/**
 * 相关度 = 同站点 3 分 + 每条共享分类 2 分 + 每个共同分区 1 分；同分按时间。
 * 只返回有交集的条目，调用方不必再过滤。
 */
export const relatedFor = (link, rows, limit = 5) => {
  const mine = facetKeys(link);
  const host = hostKey(link.url);
  const scored = [];

  for (const row of rows) {
    if (row.url === link.url) continue;
    const score =
      (hostKey(row.url) === host ? 3 : 0) +
      sharedCount(mine, facetKeys(row)) * 2 +
      row.section.filter((sid) => link.section.includes(sid)).length;
    if (score > 0) scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score || compareNewest(a.row, b.row));
  return scored.slice(0, limit).map((entry) => entry.row);
};

/** 分区内按时间排的上下条：列表最新在前，所以 prev 是更新的一条 */
export const neighbors = (link, rows, sectionId) => {
  const list = rows.filter((row) => row.section.includes(sectionId)).sort(compareNewest);
  const at = list.findIndex((row) => row.url === link.url);
  return {
    prev: at > 0 ? list[at - 1] : null,
    next: at >= 0 && at < list.length - 1 ? list[at + 1] : null,
  };
};
