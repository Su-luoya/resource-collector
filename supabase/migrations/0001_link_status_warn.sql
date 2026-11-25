-- 给已经有数据的库补上 warn：探测把 401/403/405/429 与超时记为 warn（见 src/lib/link-maintenance.mjs），
-- 但最初的建表约束只允许 ok/redirect/fail，遇到第一条 403 就会写库失败。
-- 在 Supabase SQL Editor 里执行一次即可；新库直接跑 schema.sql 不需要这份。

alter table public.link_status drop constraint if exists link_status_status_check;
alter table public.link_status
  add constraint link_status_status_check check (status in ('ok', 'redirect', 'warn', 'fail'));
