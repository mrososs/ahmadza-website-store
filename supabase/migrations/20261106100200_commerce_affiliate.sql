-- AAWRAQ platform — migration 3: commerce, payments, entitlements, affiliate ledger, contributors.
-- Rule: orders / entitlements / commissions are created ONLY by public.fulfill_payment() (service_role).

-- ---------------------------------------------------------------------------
-- Payments (gateway attempt ledger) — created BEFORE an order exists.
-- ---------------------------------------------------------------------------
create table public.payments (
  id                      uuid primary key default gen_random_uuid(),
  reference               uuid not null unique default gen_random_uuid(),
  user_id                 uuid not null references public.profiles (id) on delete restrict,
  provider                text not null check (provider in ('paymob', 'tap', 'dev_simulator')),
  provider_transaction_id text unique,                 -- last line of defence against double fulfilment
  status                  public.payment_status not null default 'pending',
  amount                  numeric(12,2) not null check (amount > 0),
  currency                char(3) not null,
  fx_rate                 numeric(14,6) not null default 1,
  mode                    public.data_mode not null default 'test',
  affiliate_id            uuid references public.profiles (id) on delete set null,  -- captured at checkout, not from the callback
  cart_snapshot           jsonb not null,               -- [{book_id,title,unit_price}] priced server-side
  raw_response            jsonb,                        -- never exposed through the Data API
  order_id                uuid unique,
  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null default now() + interval '30 minutes',
  paid_at                 timestamptz,
  fulfilled_at            timestamptz,
  check (provider <> 'dev_simulator' or mode = 'test')  -- the simulator can never represent a live payment
);
create index payments_user_idx on public.payments (user_id, created_at desc);

-- Webhook / callback idempotency: the same provider event is processed once.
create table public.payment_events (
  id          bigint generated always as identity primary key,
  provider    text not null,
  event_id    text not null,
  payment_id  uuid references public.payments (id) on delete set null,
  event_type  text,
  payload     jsonb,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Orders (append-only financial record)
-- ---------------------------------------------------------------------------
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         bigint generated always as identity unique,    -- invoice number shown to the customer
  user_id          uuid not null references public.profiles (id) on delete restrict,
  status           public.order_status not null default 'paid',
  mode             public.data_mode not null,
  total_amount     numeric(12,2) not null check (total_amount >= 0),
  currency         char(3) not null,
  affiliate_id     uuid references public.profiles (id) on delete set null,
  payment_id       uuid unique references public.payments (id) on delete restrict,
  legacy_order_id  bigint unique,
  legacy_invoice_id text,
  legacy_raw_amount text,
  legacy_response  jsonb,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index orders_user_idx on public.orders (user_id, created_at desc);

alter table public.payments
  add constraint payments_order_fk foreign key (order_id) references public.orders (id) on delete restrict;

create table public.order_items (
  id                bigint generated always as identity primary key,
  order_id          uuid not null references public.orders (id) on delete restrict,
  book_id           bigint references public.books (id) on delete set null,   -- null only for hard-deleted legacy books
  legacy_book_id    bigint,
  title_snapshot    text not null,
  unit_price        numeric(12,2) not null check (unit_price >= 0),
  -- legacy internal reporting deductions (never charged to the buyer), preserved verbatim on import
  selling_fee numeric(12,4), selling_fee_tax numeric(12,4), cart_fee numeric(12,4), book_tax numeric(12,4), net_total numeric(12,4),
  legacy_raw_cost   text,
  legacy_item_id    bigint
);
create index order_items_order_idx on public.order_items (order_id);
create unique index order_items_native_unique on public.order_items (order_id, book_id)
  where legacy_item_id is null and book_id is not null;

create or replace function public.orders_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'orders are append-only (delete refused)' using errcode = 'P0001';
  end if;
  if new.user_id <> old.user_id or new.total_amount <> old.total_amount or new.currency <> old.currency
     or new.mode <> old.mode or new.created_at <> old.created_at
     or new.affiliate_id is distinct from old.affiliate_id then
    raise exception 'financial columns of an order are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger orders_immutable before update or delete on public.orders
  for each row execute function public.orders_guard();

create or replace function public.order_items_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'order_items are immutable' using errcode = 'P0001';
end $$;
create trigger order_items_immutable before update or delete on public.order_items
  for each row execute function public.order_items_guard();

-- ---------------------------------------------------------------------------
-- Entitlements: what unlocks paid downloads.
-- ---------------------------------------------------------------------------
create table public.entitlements (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  book_id       bigint not null references public.books (id) on delete cascade,
  order_item_id bigint references public.order_items (id) on delete set null,
  is_test       boolean not null default false,        -- visibly marked test data (local simulation only)
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, book_id)
);
create index entitlements_user_idx on public.entitlements (user_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Affiliates: commissions + append-only ledger (no mutable balance column).
-- ---------------------------------------------------------------------------
create table public.affiliate_commissions (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete restrict,
  affiliate_id  uuid not null references public.profiles (id) on delete restrict,
  gross_amount  numeric(12,2) not null,
  percent       numeric(5,2)  not null,
  amount        numeric(12,2) not null,
  currency      char(3) not null,
  available_at  timestamptz not null,
  is_test       boolean not null default false,
  legacy_id     bigint unique,
  legacy_raw    jsonb,
  created_at    timestamptz not null default now(),
  unique (order_id, affiliate_id)
);
create index affiliate_commissions_aff_idx on public.affiliate_commissions (affiliate_id, created_at desc);

create table public.withdrawal_requests (
  id            uuid primary key default gen_random_uuid(),
  affiliate_id  uuid not null references public.profiles (id) on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  currency      char(3) not null,
  status        public.withdrawal_status not null default 'pending',
  payout_kind   text,
  note          text,
  proof_path    text,                                  -- private-sensitive bucket
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles (id),
  legacy_id     bigint unique,
  legacy_raw    jsonb
);
create index withdrawal_requests_aff_idx on public.withdrawal_requests (affiliate_id, requested_at desc);

create table public.affiliate_ledger (
  id            bigint generated always as identity primary key,
  affiliate_id  uuid not null references public.profiles (id) on delete restrict,
  entry_type    public.ledger_entry_type not null,
  amount        numeric(12,2) not null check (amount <> 0),   -- signed: credits > 0, debits < 0
  currency      char(3) not null,
  available_at  timestamptz not null default now(),         -- credits are frozen until this moment
  commission_id uuid references public.affiliate_commissions (id) on delete restrict,
  withdrawal_id uuid references public.withdrawal_requests (id) on delete restrict,
  is_test       boolean not null default false,
  memo          text,
  created_at    timestamptz not null default now()
);
create index affiliate_ledger_aff_idx on public.affiliate_ledger (affiliate_id, available_at);

create or replace function public.ledger_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'affiliate_ledger is append-only' using errcode = 'P0001';
end $$;
create trigger ledger_immutable before update or delete on public.affiliate_ledger
  for each row execute function public.ledger_guard();

create table public.payout_methods (
  id            bigint generated always as identity primary key,
  affiliate_id  uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('paypal', 'bank_transfer')),
  details       jsonb not null default '{}'::jsonb,    -- sensitive: owner + admin only (RLS); field encryption = open item
  created_at    timestamptz not null default now(),
  unique (affiliate_id, kind)
);

-- ---------------------------------------------------------------------------
-- Contributor submissions ("request-book"). Sensitive documents live in the private-sensitive bucket.
-- ---------------------------------------------------------------------------
create table public.contributor_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete restrict,
  title          text not null check (length(btrim(title)) > 0),
  maker_name     text,
  about          text,
  deal           public.contributor_deal not null default 'share',
  cost           numeric(12,2) check (cost is null or cost >= 0),
  currency       char(3) not null default 'USD',
  whatsapp       text,
  iban           text,                                  -- sensitive
  book_path      text,                                  -- private-sensitive object paths
  cover_path     text,
  iban_doc_path  text,
  ministry_doc_path text,
  status         public.contributor_status not null default 'pending',
  review_note    text,
  reviewed_by    uuid references public.profiles (id),
  reviewed_at    timestamptz,
  book_id        bigint references public.books (id) on delete set null,
  legacy_id      bigint unique,
  created_at     timestamptz not null default now()
);
create index contributor_requests_user_idx on public.contributor_requests (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Legacy import bookkeeping (see docs/implementation/07-historical-data-import.md)
-- ---------------------------------------------------------------------------
create table public.migration_runs (
  id          bigint generated always as identity primary key,
  kind        text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  dry_run     boolean not null default false,
  counts      jsonb not null default '{}'::jsonb,
  notes       text
);
create table public.migration_rejects (
  id        bigint generated always as identity primary key,
  run_id    bigint references public.migration_runs (id) on delete cascade,
  entity    text not null,
  legacy_id text,
  reason    text not null,
  payload   jsonb
);
create table public.legacy_id_map (
  entity     text not null,
  legacy_id  text not null,
  new_id     text not null,
  run_id     bigint references public.migration_runs (id) on delete set null,
  primary key (entity, legacy_id)
);

-- Inventory of recovered media. Orphans (no book mapping) stay here, quarantined, never published.
create table public.legacy_media_staging (
  id            bigint generated always as identity primary key,
  legacy_path   text not null unique,                   -- e.g. storage/app/public/product_media/<name>.pdf
  sha256        text not null,
  byte_size     bigint not null,
  detected_type text not null,                          -- from magic bytes, not the extension
  status        public.staging_status not null default 'inventoried',
  reason        text,
  storage_path  text,                                   -- object in the private `legacy-staging` bucket
  duplicate_of  bigint references public.legacy_media_staging (id),
  book_media_id bigint references public.book_media (id) on delete set null,
  batch_id      text,
  updated_at    timestamptz not null default now()
);
create index legacy_media_staging_sha_idx on public.legacy_media_staging (sha256);
create index legacy_media_staging_status_idx on public.legacy_media_staging (status);

-- ===========================================================================
-- Trusted functions (service_role only — execute is revoked from everyone else at the end)
-- ===========================================================================

-- Server-side pricing: the browser sends book ids only. Totals are computed here.
create or replace function public.create_payment_for_cart(
  p_user uuid, p_book_ids bigint[], p_affiliate uuid, p_provider text, p_mode public.data_mode
) returns public.payments
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.site_settings;
  v_profile  public.profiles;
  v_ids      bigint[];
  v_found    integer;
  v_total    numeric(12,2);
  v_snapshot jsonb;
  v_aff      uuid := null;
  v_pay      public.payments;
begin
  select * into v_settings from public.site_settings where id = 1;
  select * into v_profile  from public.profiles where id = p_user and deleted_at is null;
  if not found then raise exception 'unknown user' using errcode = 'P0002'; end if;
  if v_profile.status <> 'active' then
    raise exception 'account is not allowed to purchase (status=%)', v_profile.status using errcode = '42501';
  end if;
  if p_mode = 'test' and not v_settings.allow_test_payments then
    raise exception 'test payments are disabled' using errcode = '42501';
  end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_book_ids, '{}')) as x;
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'cart is empty' using errcode = '22023'; end if;

  select count(*), sum(b.price_amount),
         jsonb_agg(jsonb_build_object('book_id', b.id, 'title', b.title, 'unit_price', b.price_amount) order by b.id)
    into v_found, v_total, v_snapshot
    from public.books b
   where b.id = any (v_ids) and b.status = 'published' and b.deleted_at is null and b.kind = 'paid' and b.price_amount > 0;
  if v_found <> array_length(v_ids, 1) then
    raise exception 'cart contains unavailable, free or unpublished books' using errcode = '22023';
  end if;
  if exists (select 1 from public.entitlements e where e.user_id = p_user and e.book_id = any (v_ids) and e.revoked_at is null) then
    raise exception 'cart contains a book that is already in the library' using errcode = '23505';
  end if;

  if p_affiliate is not null and p_affiliate <> p_user
     and exists (select 1 from public.profiles a where a.id = p_affiliate and a.is_affiliate and a.status = 'active') then
    v_aff := p_affiliate;
  end if;

  insert into public.payments (user_id, provider, status, amount, currency, mode, affiliate_id, cart_snapshot)
  values (p_user, p_provider, 'pending', v_total, v_settings.base_currency, p_mode, v_aff, v_snapshot)
  returning * into v_pay;
  return v_pay;
end $$;

-- The ONLY creator of orders, entitlements and commissions. Idempotent.
create or replace function public.fulfill_payment(
  p_payment_id uuid, p_provider_txn text, p_amount numeric, p_currency text, p_raw jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_pay      public.payments;
  v_set      public.site_settings;
  v_order    uuid;
  v_is_test  boolean;
  v_comm     uuid;
  v_amt      numeric(12,2);
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found' using errcode = 'P0002'; end if;
  if v_pay.order_id is not null then return v_pay.order_id; end if;           -- replay: same answer, no side effects
  if v_pay.status in ('failed', 'cancelled', 'expired') then
    raise exception 'payment is %', v_pay.status using errcode = '22023';
  end if;
  if p_amount is distinct from v_pay.amount or upper(p_currency) is distinct from v_pay.currency then
    raise exception 'verified amount/currency does not match the payment' using errcode = '22023';
  end if;

  select * into v_set from public.site_settings where id = 1;
  v_is_test := (v_pay.mode = 'test');
  if v_is_test and not v_set.allow_test_payments then
    raise exception 'test payments are disabled' using errcode = '42501';
  end if;

  insert into public.orders (user_id, status, mode, total_amount, currency, affiliate_id, payment_id)
  values (v_pay.user_id, 'paid', v_pay.mode, v_pay.amount, v_pay.currency, v_pay.affiliate_id, v_pay.id)
  returning id into v_order;

  insert into public.order_items (order_id, book_id, title_snapshot, unit_price)
  select v_order, (i ->> 'book_id')::bigint, i ->> 'title', (i ->> 'unit_price')::numeric
    from jsonb_array_elements(v_pay.cart_snapshot) as i;

  insert into public.entitlements (user_id, book_id, order_item_id, is_test)
  select v_pay.user_id, oi.book_id, oi.id, v_is_test
    from public.order_items oi where oi.order_id = v_order and oi.book_id is not null
  on conflict (user_id, book_id) do update set revoked_at = null, is_test = excluded.is_test, order_item_id = excluded.order_item_id;

  if v_pay.affiliate_id is not null then
    v_amt := round(v_pay.amount * v_set.affiliate_commission_percent / 100, 2);
    if v_amt > 0 then
      insert into public.affiliate_commissions (order_id, affiliate_id, gross_amount, percent, amount, currency, available_at, is_test)
      values (v_order, v_pay.affiliate_id, v_pay.amount, v_set.affiliate_commission_percent, v_amt, v_pay.currency,
              now() + make_interval(days => v_set.commission_freeze_days), v_is_test)
      returning id into v_comm;
      insert into public.affiliate_ledger (affiliate_id, entry_type, amount, currency, available_at, commission_id, is_test, memo)
      values (v_pay.affiliate_id, 'commission', v_amt, v_pay.currency,
              now() + make_interval(days => v_set.commission_freeze_days), v_comm, v_is_test, 'order ' || v_order::text);
    end if;
  end if;

  update public.payments
     set status = 'succeeded', provider_transaction_id = p_provider_txn, raw_response = p_raw,
         paid_at = now(), fulfilled_at = now(), order_id = v_order
   where id = v_pay.id;
  return v_order;
end $$;

-- Idempotent webhook/callback registration: returns true only the first time an event id is seen.
create or replace function public.register_payment_event(
  p_provider text, p_event_id text, p_payment_id uuid, p_type text, p_payload jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.payment_events (provider, event_id, payment_id, event_type, payload)
  values (p_provider, p_event_id, p_payment_id, p_type, p_payload)
  on conflict (provider, event_id) do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.fail_payment(p_payment_id uuid, p_status public.payment_status, p_raw jsonb default null)
returns void language sql security definer set search_path = '' as $$
  update public.payments set status = p_status, raw_response = coalesce(p_raw, raw_response)
   where id = p_payment_id and order_id is null and status = 'pending' and p_status in ('failed', 'cancelled', 'expired');
$$;

-- Balances derive from the ledger (never from a mutable column).
create or replace function public.affiliate_balance(p_affiliate uuid)
returns table (available numeric, frozen numeric, pending_withdrawal numeric, paid_out numeric, currency text)
language plpgsql stable security definer set search_path = '' as $$
declare v_test boolean;
begin
  if p_affiliate is distinct from (select auth.uid()) and not public.is_admin() and (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select s.allow_test_payments into v_test from public.site_settings s where s.id = 1;
  return query
  select coalesce(sum(l.amount) filter (where l.available_at <= now()), 0)::numeric,
         coalesce(sum(l.amount) filter (where l.entry_type = 'commission' and l.available_at > now()), 0)::numeric,
         coalesce((select sum(w.amount) from public.withdrawal_requests w where w.affiliate_id = p_affiliate and w.status = 'pending'), 0)::numeric,
         coalesce((select sum(w.amount) from public.withdrawal_requests w where w.affiliate_id = p_affiliate and w.status = 'paid'), 0)::numeric,
         (select s.base_currency::text from public.site_settings s where s.id = 1)
    from public.affiliate_ledger l
   where l.affiliate_id = p_affiliate and (not l.is_test or v_test);
end $$;

create or replace function public.request_withdrawal(p_affiliate uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_prof public.profiles; v_set public.site_settings; v_avail numeric; v_kind text; v_id uuid;
begin
  select * into v_prof from public.profiles where id = p_affiliate for update;   -- per-affiliate mutex
  if not found or not v_prof.is_affiliate or v_prof.status <> 'active' then
    raise exception 'not an active affiliate' using errcode = '42501';
  end if;
  select * into v_set from public.site_settings where id = 1;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount' using errcode = '22023'; end if;
  if p_amount < v_set.min_withdrawal_amount then
    raise exception 'amount below the minimum withdrawal (%)', v_set.min_withdrawal_amount using errcode = '22023';
  end if;
  select coalesce(sum(l.amount), 0) into v_avail from public.affiliate_ledger l
   where l.affiliate_id = p_affiliate and l.available_at <= now() and (not l.is_test or v_set.allow_test_payments);
  if p_amount > v_avail then raise exception 'insufficient available balance' using errcode = '22023'; end if;
  select pm.kind into v_kind from public.payout_methods pm where pm.affiliate_id = p_affiliate order by pm.id limit 1;
  if v_kind is null then raise exception 'no payout method configured' using errcode = '22023'; end if;

  insert into public.withdrawal_requests (affiliate_id, amount, currency, payout_kind)
  values (p_affiliate, p_amount, v_set.base_currency, v_kind) returning id into v_id;
  insert into public.affiliate_ledger (affiliate_id, entry_type, amount, currency, withdrawal_id, memo)
  values (p_affiliate, 'withdrawal_hold', -p_amount, v_set.base_currency, v_id, 'withdrawal request');
  return v_id;
end $$;

create or replace function public.decide_withdrawal(p_request uuid, p_admin uuid, p_approve boolean, p_note text default null, p_proof_path text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_w public.withdrawal_requests;
begin
  select * into v_w from public.withdrawal_requests where id = p_request for update;
  if not found then raise exception 'withdrawal not found' using errcode = 'P0002'; end if;
  if v_w.status <> 'pending' then raise exception 'withdrawal already decided' using errcode = '22023'; end if;
  update public.withdrawal_requests
     set status = case when p_approve then 'paid'::public.withdrawal_status else 'rejected'::public.withdrawal_status end,
         decided_at = now(), decided_by = p_admin, note = p_note, proof_path = coalesce(p_proof_path, proof_path)
   where id = p_request;
  if not p_approve then
    insert into public.affiliate_ledger (affiliate_id, entry_type, amount, currency, withdrawal_id, memo)
    values (v_w.affiliate_id, 'withdrawal_release', v_w.amount, v_w.currency, v_w.id, 'withdrawal rejected');
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, diff)
  values (p_admin, case when p_approve then 'withdrawal_paid' else 'withdrawal_rejected' end, 'withdrawal_requests', p_request::text,
          jsonb_build_object('amount', v_w.amount, 'note', p_note));
end $$;

-- Approval creates a DRAFT book owned by the contributor; publishing remains an admin action.
create or replace function public.approve_contributor_request(p_request uuid, p_admin uuid, p_note text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_r public.contributor_requests; v_book bigint;
begin
  select * into v_r from public.contributor_requests where id = p_request for update;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_r.status <> 'pending' then raise exception 'request already reviewed' using errcode = '22023'; end if;
  insert into public.books (title, description_html, kind, status, price_amount, price_currency, owner_id)
  values (v_r.title, v_r.about, case when coalesce(v_r.cost, 0) > 0 then 'paid'::public.book_kind else 'free'::public.book_kind end,
          'draft', coalesce(v_r.cost, 0), v_r.currency, v_r.user_id)
  returning id into v_book;
  update public.contributor_requests
     set status = 'approved', reviewed_by = p_admin, reviewed_at = now(), review_note = p_note, book_id = v_book
   where id = p_request;
  insert into public.audit_log (actor_id, action, entity, entity_id, diff)
  values (p_admin, 'contributor_approved', 'contributor_requests', p_request::text, jsonb_build_object('book_id', v_book));
  return v_book;
end $$;

create or replace function public.decline_contributor_request(p_request uuid, p_admin uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.contributor_requests
     set status = 'declined', reviewed_by = p_admin, reviewed_at = now(), review_note = p_note
   where id = p_request and status = 'pending';
  if not found then raise exception 'request not pending' using errcode = '22023'; end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, diff)
  values (p_admin, 'contributor_declined', 'contributor_requests', p_request::text, jsonb_build_object('note', p_note));
end $$;

-- Atomic view counter used by the server (service_role).
create or replace function public.increment_view(p_entity text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_entity = 'book' then update public.books set view_count = view_count + 1 where id = p_id;
  elsif p_entity = 'article' then update public.articles set view_count = view_count + 1 where id = p_id;
  end if;
end $$;

-- Lock every trusted function to service_role.
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_payment_for_cart(uuid,bigint[],uuid,text,public.data_mode)',
    'public.fulfill_payment(uuid,text,numeric,text,jsonb)',
    'public.register_payment_event(text,text,uuid,text,jsonb)',
    'public.fail_payment(uuid,public.payment_status,jsonb)',
    'public.request_withdrawal(uuid,numeric)',
    'public.decide_withdrawal(uuid,uuid,boolean,text,text)',
    'public.approve_contributor_request(uuid,uuid,text)',
    'public.decline_contributor_request(uuid,uuid,text)',
    'public.increment_view(text,bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

create trigger audit_withdrawals after insert or update on public.withdrawal_requests
  for each row execute function public.audit_row_change();
create trigger audit_contributor after update on public.contributor_requests
  for each row execute function public.audit_row_change();
