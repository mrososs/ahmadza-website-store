-- Slice A: public comment listing with the author's display name (profiles are otherwise private).
-- Visibility rule (legacy show_in_home): approved comments are public only when visible_to_public;
-- buyers of the book (owns_book) and the comment's own author additionally see the rest.
create or replace function public.book_comments(p_book bigint)
returns table (id bigint, body text, created_at timestamptz, author_name text, is_mine boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.body, c.created_at, coalesce(nullif(p.display_name, ''), 'مستخدم') as author_name,
         (c.user_id = (select auth.uid())) as is_mine
    from public.comments c
    join public.profiles p on p.id = c.user_id
    join public.books b on b.id = c.book_id and b.status in ('published', 'coming_soon') and b.deleted_at is null
   where c.book_id = p_book
     and ( (c.status = 'approved' and (c.visible_to_public or public.owns_book(c.book_id) or public.is_admin()))
           or c.user_id = (select auth.uid()) )
   order by c.created_at desc
   limit 200
$$;
grant execute on function public.book_comments(bigint) to anon, authenticated;
