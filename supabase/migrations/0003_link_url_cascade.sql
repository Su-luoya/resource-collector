-- 改地址只更新 links 主键；体检外键在同一事务里跟过去，不需要先删资源再重建。
alter table public.link_status
  drop constraint link_status_url_fkey,
  add constraint link_status_url_fkey foreign key (url) references public.links (url)
    on update cascade on delete cascade;
