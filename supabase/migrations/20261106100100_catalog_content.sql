-- AAWRAQ platform — migration 2: catalog & content.
-- Mirrors docs/legacy-audit/13 §4.1. IDs for public entities are bigint identities so the legacy
-- URL shape /book/{id}/{slug} can be preserved. `is_demo` marks development-only seed rows
-- (see supabase/seed.sql and public.purge_demo_data()).

create table public.categories (
  id          bigint generated always as identity primary key,
  name        text not null check (length(btrim(name)) > 0),
  slug        text not null,
  image_path  text,                       -- public-media object path (legacy images were not recovered)
  is_active   boolean not null default true,
  is_demo     boolean not null default false,
  legacy_id   bigint unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();

create table public.makers (
  id          bigint generated always as identity primary key,
  name        text not null check (length(btrim(name)) > 0),
  kind        public.maker_kind not null default 'author',
  era         public.maker_era  not null default 'new',
  bio_html    text,                       -- sanitised on save (server) — never trusted raw
  image_path  text,
  is_active   boolean not null default true,
  is_demo     boolean not null default false,
  legacy_id   bigint unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger makers_touch before update on public.makers for each row execute function public.touch_updated_at();

create table public.books (
  id               bigint generated always as identity primary key,
  title            text not null check (length(btrim(title)) > 0),
  title_norm       text not null default '',
  slug             text not null default '',
  description_html text,                  -- sanitised on save
  kind             public.book_kind not null default 'paid',
  status           public.content_status not null default 'draft',
  price_amount     numeric(12,2) not null default 0 check (price_amount >= 0),
  price_currency   char(3) not null default 'USD',
  pages            integer not null default 0 check (pages >= 0),
  cover_path       text,
  owner_id         uuid references public.profiles (id) on delete set null,   -- contributor, if any
  view_count       integer not null default 0,
  is_demo          boolean not null default false,
  legacy_id        bigint unique,
  legacy_cost_raw  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  -- a paid book needs a positive price; a free book is always 0.00
  constraint books_price_matches_kind check (
    (kind = 'free' and price_amount = 0) or (kind = 'paid' and price_amount > 0) or status = 'draft'
  )
);
create index books_listing_idx on public.books (status, created_at desc) where deleted_at is null;
create index books_title_trgm_idx on public.books using gin (title_norm extensions.gin_trgm_ops);
create index books_owner_idx on public.books (owner_id);

create or replace function public.books_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.title_norm := public.normalize_ar(new.title);
  if coalesce(new.slug, '') = '' then
    new.slug := regexp_replace(lower(btrim(new.title)), '[^\w؀-ۿ]+', '-', 'g');
    new.slug := btrim(new.slug, '-');
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger books_write before insert or update on public.books for each row execute function public.books_before_write();

create table public.book_categories (
  book_id     bigint not null references public.books (id) on delete cascade,
  category_id bigint not null references public.categories (id) on delete restrict,
  primary key (book_id, category_id)
);
create index book_categories_category_idx on public.book_categories (category_id);

create table public.book_makers (
  book_id  bigint not null references public.books (id) on delete cascade,
  maker_id bigint not null references public.makers (id) on delete restrict,
  role     public.maker_kind not null,
  primary key (book_id, maker_id, role)
);
create index book_makers_maker_idx on public.book_makers (maker_id);

create table public.book_tags (
  book_id bigint not null references public.books (id) on delete cascade,
  tag     text not null check (length(btrim(tag)) > 0),
  primary key (book_id, tag)
);

-- Symmetric pairs stored once (legacy related_books semantics still to be confirmed by the owner — docs/16).
create table public.book_relations (
  book_id    bigint not null references public.books (id) on delete cascade,
  related_id bigint not null references public.books (id) on delete cascade,
  primary key (book_id, related_id),
  check (book_id < related_id)
);

-- Files attached to a book. storage_path lives in the PRIVATE bucket `private-products`; it is never
-- exposed to anon/authenticated (column grants in the RLS migration) — only the trusted server reads it.
create table public.book_media (
  id            bigint generated always as identity primary key,
  book_id       bigint not null references public.books (id) on delete cascade,
  kind          public.media_kind not null default 'file',
  visibility    public.media_visibility not null default 'after_purchase',
  name          text not null default '',
  extension     text,
  page_count    integer not null default 0,
  sort_order    integer not null default 0,
  is_external   boolean not null default false,
  external_url  text,
  storage_path  text,
  mime_type     text,
  byte_size     bigint,
  sha256        text,
  legacy_path   text,
  legacy_book_media_id bigint,
  legacy_download_count integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint book_media_source check (
    (is_external and external_url is not null and storage_path is null)
    or (not is_external and storage_path is not null)
    or (storage_path is null and external_url is null)   -- placeholder row awaiting an upload / missing media
  )
);
create index book_media_book_idx on public.book_media (book_id, sort_order);
create unique index book_media_legacy_idx on public.book_media (legacy_book_media_id) where legacy_book_media_id is not null;
create trigger book_media_touch before update on public.book_media for each row execute function public.touch_updated_at();

create table public.articles (
  id           bigint generated always as identity primary key,
  kind         public.article_kind not null default 'article',
  title        text not null check (length(btrim(title)) > 0),
  excerpt      text,
  content_html text,                      -- sanitised on save
  poster_path  text,
  status       public.content_status not null default 'draft',
  author_id    uuid references public.profiles (id) on delete set null,
  view_count   integer not null default 0,
  is_demo      boolean not null default false,
  legacy_id    bigint unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger articles_touch before update on public.articles for each row execute function public.touch_updated_at();

create table public.pages (
  id           bigint generated always as identity primary key,
  slug         text not null check (slug ~ '^[^\s/]+$'),
  title        text not null,
  content_html text,
  positions    text[] not null default '{}' check (positions <@ array['header', 'footer']),
  status       public.content_status not null default 'draft',
  is_demo      boolean not null default false,
  legacy_id    bigint unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index pages_slug_live_idx on public.pages (slug) where deleted_at is null;
create trigger pages_touch before update on public.pages for each row execute function public.touch_updated_at();

create table public.comments (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  book_id           bigint not null references public.books (id) on delete cascade,
  body              text not null check (length(btrim(body)) between 1 and 4000),
  status            public.comment_status not null default 'pending',
  visible_to_public boolean not null default false,   -- legacy show_in_home
  legacy_id         bigint unique,
  created_at        timestamptz not null default now()
);
create index comments_book_idx on public.comments (book_id, created_at desc);

create table public.favourites (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  book_id    bigint references public.books (id) on delete cascade,
  article_id bigint references public.articles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((book_id is null) <> (article_id is null))
);
create unique index favourites_user_book_idx    on public.favourites (user_id, book_id)    where book_id is not null;
create unique index favourites_user_article_idx on public.favourites (user_id, article_id) where article_id is not null;

create table public.contact_messages (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  name       text not null,
  email      text not null,
  subject    text not null check (subject in ('note', 'request', 'report', 'other')),
  message    text not null check (length(message) between 1 and 5000),
  is_handled boolean not null default false,
  created_at timestamptz not null default now()
);

-- Public RPC-free helpers -----------------------------------------------------
-- Demo data purge: removes everything seeded for UI testing (is_demo = true) and nothing else.
create or replace function public.purge_demo_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.books      where is_demo;
  delete from public.articles   where is_demo;
  delete from public.pages      where is_demo;
  delete from public.makers     where is_demo;
  delete from public.categories where is_demo;
end $$;
revoke all on function public.purge_demo_data() from public, anon, authenticated;

create trigger audit_books      after insert or update or delete on public.books      for each row execute function public.audit_row_change();
create trigger audit_categories after insert or update or delete on public.categories for each row execute function public.audit_row_change();
create trigger audit_makers     after insert or update or delete on public.makers     for each row execute function public.audit_row_change();
create trigger audit_pages      after insert or update or delete on public.pages      for each row execute function public.audit_row_change();
