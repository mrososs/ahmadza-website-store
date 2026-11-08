-- Recovered articles carry no original publication date: the storefront must not show the import time as one.
alter table public.articles add column if not exists date_is_original boolean not null default true;
update public.articles set date_is_original = false where source_system is not null;
grant select (date_is_original) on public.articles to anon, authenticated;
