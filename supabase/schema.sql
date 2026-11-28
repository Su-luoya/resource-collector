-- resource-collector 的云端表结构。在 Supabase SQL Editor 里整份执行。
-- 约定：写权限只给 service_role（本地 .env 与 Actions secrets 里的 secret key），
-- 匿名/公钥只有 SELECT，所以线上静态站在构建时能读、任何人都改不了数据。

create table if not exists public.links (
  url         text primary key,
  title       text not null,
  section     text[] not null check (array_length(section, 1) >= 1),
  facets      jsonb not null default '{}'::jsonb,
  "desc"      text not null,
  added       date not null default current_date,
  note        text,
  unread      boolean not null default false
);

comment on column public.links.note is 'Markdown 子集写的研究笔记，空值表示没有';
comment on column public.links.unread is 'true 表示「待看」，对应 YAML 里的 read: false';

-- 置顶功能已下线：老库重跑这份 schema 时顺手把列删掉（新库建表就没有它）
alter table public.links drop column if exists pin;

-- updated_at 没人写也没人读（写库走整行 upsert，没有触发器），已从建表语句里删掉；
-- 老库要跟上的话跑 migrations/0002_drop_updated_at.sql。

create index if not exists links_section_idx on public.links using gin (section);
create index if not exists links_added_idx on public.links (added desc);
create index if not exists links_unread_idx on public.links (unread) where unread;

-- 周检写进来的体检结果：一行一个 URL，只保留最近一次
create table if not exists public.link_status (
  url      text primary key references public.links (url) on delete cascade,
  status   text not null check (status in ('ok', 'redirect', 'warn', 'fail')),
  code     integer,
  target   text,
  checked  date not null default current_date,
  error    text
);

-- 图标映射：file 是 Storage 桶 icons 里的对象名（public 下相对路径，如 icons/x.ico）；
-- file 为空表示「取不到」，missed_at 用来判断多久之后再重试
create table if not exists public.icons (
  host        text primary key,
  file        text,
  missed_at   timestamptz
);

-- 图标字节本身存在 Storage 桶 icons（public read），仓库不保存图片文件：
-- 发布时 fetch-icons 上传，构建前 npm run sync 下到 public/icons/（git-ignored）。
-- 桶不能在应用里建，这一句在 Supabase SQL Editor 里跑一次即可（重复跑无害）。
insert into storage.buckets (id, name, public)
values ('icons', 'icons', true)
on conflict (id) do update set public = true;

alter table public.links       enable row level security;
alter table public.link_status enable row level security;
alter table public.icons       enable row level security;

drop policy if exists "public read links" on public.links;
drop policy if exists "public read link_status" on public.link_status;
drop policy if exists "public read icons" on public.icons;

create policy "public read links"       on public.links       for select using (true);
create policy "public read link_status" on public.link_status for select using (true);
create policy "public read icons"       on public.icons       for select using (true);

-- 没有 insert/update/delete 策略，写只能走 service_role（它绕过 RLS）
grant select on public.links, public.link_status, public.icons to anon, authenticated;
