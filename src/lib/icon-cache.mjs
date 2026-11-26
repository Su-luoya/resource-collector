// 图标失败缓存：取不到图标的域名记下日期，30 天内不再重试。
// 发布里最贵的那 20 多秒几乎全花在反复重试「根本没有 favicon」的站点上，
// 缓存后发布回到 1–2 秒；真恢复了就等过期后再自动补，或手动 `npm run icons -- --force`。
//
// 记录存在云端 icons 表里（file 为空 + missed_at），不再有本地缓存文件。

export const MISS_DAYS = 30;

const DAY = 86_400_000;

/** 这条失败记录是否已经过期、值得再试一次；日期读不懂就当过期（宁可多试一次） */
export const isRetryable = (missedAt, now = Date.now(), days = MISS_DAYS) => {
  const at = Date.parse(missedAt);
  if (!Number.isFinite(at)) return true;
  return now - at >= days * DAY;
};

/** 快照一行给日志看：`3 天前取不到` */
export const describeMiss = (missedAt, now = Date.now()) => {
  const at = Date.parse(missedAt);
  if (!Number.isFinite(at)) return '取不到';
  const days = Math.floor((now - at) / DAY);
  return days <= 0 ? '今天取不到' : `${days} 天前取不到`;
};
