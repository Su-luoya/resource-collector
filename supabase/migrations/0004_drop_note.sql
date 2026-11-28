-- 笔记功能已下线：站上不再渲染，dev 表单也没有入口。
-- 已经写过的笔记随列一起删掉，无法恢复。
alter table public.links drop column if exists note;
