-- Bulk book administration: free / paid / soft-delete over a set of books in ONE transaction.
-- Only price/kind or deleted_at change: the publication status, every other column, order_items (immutable snapshots),
-- entitlements, payments and commissions are never touched. Each book is validated under a row lock and handled in its own
-- sub-transaction, so one refused book (e.g. a recovered book that is not publication-ready) is reported as skipped and
-- does not abort or half-apply the rest. The audit entry of every changed book is written in the same transaction.
-- Public-PDF rule, evaluated inside the database so it is checked under the book's row lock (mirrors assessReader().publicFullPdf in
-- shared/utils/readerReadiness.ts): a PREVIEW pdf that is the same file as, or at least as long as, a protected full pdf gives the book away.
create or replace function public.book_has_public_full_pdf(p_book bigint) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.book_media p join public.book_media f on f.book_id = p.book_id
     where p.book_id = p_book
       and p.visibility = 'preview' and lower(coalesce(p.extension, '')) = 'pdf'
       and f.visibility = 'after_purchase' and lower(coalesce(f.extension, '')) = 'pdf'
       and ((coalesce(p.sha256, '') <> '' and p.sha256 = f.sha256) or (p.page_count > 0 and f.page_count > 0 and p.page_count >= f.page_count)))
$$;
revoke all on function public.book_has_public_full_pdf(bigint) from public, anon, authenticated;
grant execute on function public.book_has_public_full_pdf(bigint) to service_role;

-- A media write takes a SHARE lock on its book. A bulk conversion holds the book row FOR UPDATE, so a concurrent media insert / change either
-- finishes before the conversion looks (and is seen by the check) or waits until the conversion has committed. No third ordering exists.
create or replace function public.book_media_serialize_with_book() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.books where id = new.book_id for share;
  return new;
end $$;
revoke all on function public.book_media_serialize_with_book() from public, anon, authenticated;
drop trigger if exists book_media_serialize_with_book on public.book_media;
create trigger book_media_serialize_with_book before insert or update of visibility, extension, sha256, page_count, book_id on public.book_media
  for each row execute function public.book_media_serialize_with_book();

create or replace function public.admin_bulk_books(p_op text, p_ids bigint[], p_price numeric, p_admin uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  b public.books%rowtype;
  v_updated bigint[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_old jsonb;
  v_new jsonb;
begin
  if p_op not in ('make_free', 'make_paid', 'soft_delete') then
    raise exception 'invalid bulk operation' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 200 then
    raise exception 'invalid selection size' using errcode = '22023';
  end if;
  if p_op = 'make_paid' and (p_price is null or p_price <= 0 or p_price > 100000 or p_price <> round(p_price, 2)) then
    raise exception 'invalid price' using errcode = '22023';
  end if;

  -- ascending id order: concurrent bulk calls lock rows in the same order (no deadlock)
  for v_id in select distinct x from unnest(p_ids) as x order by x loop
    select * into b from public.books where id = v_id for update;
    if not found then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'not_found');
    elsif b.deleted_at is not null then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'already_deleted');
    elsif p_op = 'make_paid' and b.status = 'published' and public.book_has_public_full_pdf(v_id) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'public_full_pdf');
    elsif (p_op = 'make_free' and b.kind = 'free' and b.price_amount = 0)
       or (p_op = 'make_paid' and b.kind = 'paid' and b.price_amount = p_price) then
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'unchanged');
    else
      begin
        if p_op = 'make_free' then
          v_old := jsonb_build_object('kind', b.kind, 'price_amount', b.price_amount);
          update public.books set kind = 'free', price_amount = 0 where id = v_id;
          v_new := jsonb_build_object('kind', 'free', 'price_amount', 0);
        elsif p_op = 'make_paid' then
          v_old := jsonb_build_object('kind', b.kind, 'price_amount', b.price_amount);
          update public.books set kind = 'paid', price_amount = p_price where id = v_id;
          v_new := jsonb_build_object('kind', 'paid', 'price_amount', p_price);
        else
          v_old := jsonb_build_object('deleted_at', null);
          update public.books set deleted_at = now() where id = v_id;
          v_new := jsonb_build_object('deleted_at', now());
        end if;
        insert into public.audit_log (actor_id, action, entity, entity_id, diff)
        values (p_admin, 'bulk.' || p_op, 'books', v_id::text, jsonb_build_object('old', v_old, 'new', v_new, 'bulk', true));
        v_updated := v_updated || v_id;
      exception
        when sqlstate 'AW001' then
          v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'not_eligible');
        when check_violation then
          v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', 'invalid_price');
      end;
    end if;
  end loop;

  return jsonb_build_object('updated', to_jsonb(v_updated), 'skipped', v_skipped);
end $$;

revoke all on function public.admin_bulk_books(text, bigint[], numeric, uuid) from public, anon, authenticated;
grant execute on function public.admin_bulk_books(text, bigint[], numeric, uuid) to service_role;
