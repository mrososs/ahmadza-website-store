-- DEVELOPMENT-ONLY seed (supabase db reset). Every row below is mock data flagged is_demo = true.
-- It is NOT recovered client data. Remove it with:  select public.purge_demo_data();
-- Titles intentionally read "تجريبي" (test) so nothing can be mistaken for the real catalog.

-- Local dev switches (migrations keep these OFF by default)
update public.site_settings
   set allow_test_payments = true,
       email = 'info@example.invalid',
       phone = '+000 000 0000',
       description = 'نسخة تطوير محلية — بيانات تجريبية فقط',
       show_free_book_button = true
 where id = 1;

insert into public.categories (name, slug, is_demo)
select 'قسم تجريبي ' || g, 'qism-tajribi-' || g, true from generate_series(1, 6) g;

insert into public.makers (name, kind, era, bio_html, is_demo)
select 'مؤلف تجريبي ' || g,
       (array['author','reader','writer'])[1 + (g % 3)]::public.maker_kind,
       (array['new','old'])[1 + (g % 2)]::public.maker_era,
       '<p>نبذة تجريبية عن الشخصية رقم ' || g || ' — بيانات للاختبار فقط.</p>', true
  from generate_series(1, 9) g;

-- 30 books: 6 free (every 5th), 1 draft, 1 coming soon, the rest published
insert into public.books (title, description_html, kind, status, price_amount, pages, is_demo, created_at)
select 'كتاب تجريبي رقم ' || g,
       '<p>وصف تجريبي للكتاب رقم ' || g || '. هذه بيانات اختبار للواجهة وليست من أرشيف العميل.</p>',
       case when g % 5 = 0 then 'free'::public.book_kind else 'paid'::public.book_kind end,
       case when g = 29 then 'draft'::public.content_status
            when g = 30 then 'coming_soon'::public.content_status
            else 'published'::public.content_status end,
       case when g % 5 = 0 then 0 else (5 + (g % 7) * 2.5)::numeric(12,2) end,
       40 + g * 3, true, now() - make_interval(hours => g)
  from generate_series(1, 30) g;

insert into public.book_categories (book_id, category_id)
select b.id, c.id
  from public.books b
  join public.categories c on c.id = (select min(id) from public.categories where is_demo) + (b.id % 6)
 where b.is_demo;

insert into public.book_makers (book_id, maker_id, role)
select b.id, m.id, m.kind
  from public.books b
  join public.makers m on m.id = (select min(id) from public.makers where is_demo) + (b.id % 9)
 where b.is_demo;

insert into public.book_tags (book_id, tag)
select b.id, t from public.books b, unnest(array['تجريبي', 'اختبار']) t where b.is_demo;

insert into public.book_relations (book_id, related_id)
select b.id, b.id + 1 from public.books b where b.is_demo and b.id % 4 = 1
  and exists (select 1 from public.books x where x.id = b.id + 1);

insert into public.articles (kind, title, excerpt, content_html, status, is_demo)
select 'article', 'عنوان مقال تجريبي ' || g, 'مقتطف تجريبي للمقال رقم ' || g,
       '<p>محتوى تجريبي للمقال رقم ' || g || '.</p>', 'published', true
  from generate_series(1, 6) g;

insert into public.pages (slug, title, content_html, positions, status, is_demo) values
  ('terms',   'سياسة الاستخدام (نموذج تجريبي)', '<p>نص تجريبي — يجب على المالك تزويد النص القانوني الفعلي.</p>', array['footer'], 'published', true),
  ('privacy', 'سياسة الخصوصية (نموذج تجريبي)',  '<p>نص تجريبي — يجب على المالك تزويد النص القانوني الفعلي.</p>', array['footer'], 'published', true),
  ('about',   'من نحن (نموذج تجريبي)',          '<p>نص تجريبي.</p>', array['footer'], 'published', true);
