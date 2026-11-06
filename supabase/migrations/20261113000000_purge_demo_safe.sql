-- purge_demo_data() must not fail once a demo book has been purchased: order_items are immutable and
-- reference books, so purchased demo books are ARCHIVED + soft-deleted (history preserved) instead of deleted.
create or replace function public.purge_demo_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.books b
   where b.is_demo
     and not exists (select 1 from public.order_items oi where oi.book_id = b.id)
     and not exists (select 1 from public.entitlements e where e.book_id = b.id);
  update public.books set status = 'archived', deleted_at = coalesce(deleted_at, now())
   where is_demo and deleted_at is null;
  delete from public.articles   where is_demo;
  delete from public.pages      where is_demo;
  delete from public.makers m   where is_demo and not exists (select 1 from public.book_makers bm where bm.maker_id = m.id);
  delete from public.categories c where is_demo and not exists (select 1 from public.book_categories bc where bc.category_id = c.id);
  update public.makers set is_active = false, deleted_at = coalesce(deleted_at, now()) where is_demo and deleted_at is null;
  update public.categories set is_active = false, deleted_at = coalesce(deleted_at, now()) where is_demo and deleted_at is null;
end $$;
revoke all on function public.purge_demo_data() from public, anon, authenticated;
grant execute on function public.purge_demo_data() to service_role;
