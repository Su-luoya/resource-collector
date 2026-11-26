-- updated_at 是建表时留下的死列：写库走 PostgREST 的整行 upsert，没有触发器更新它，
-- 也没有任何地方读它（页面的时间轴用 links.added）。新库跑 schema.sql 就不带它。
-- 在 Supabase SQL Editor 里执行一次即可。

alter table public.links drop column if exists updated_at;
alter table public.icons drop column if exists updated_at;
