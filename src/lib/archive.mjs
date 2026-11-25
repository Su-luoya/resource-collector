// 网页存档兜底：本站不存快照，只把读者带到 Wayback Machine。
//
// 用日历页而不是「最近一次快照」直链：后者在某个 URL 还没被存档时会落到错误页，
// 日历页则始终能打开，有没有快照由 Wayback 自己说清楚。
export const archiveHref = (url) => `https://web.archive.org/web/*/${url}`;
