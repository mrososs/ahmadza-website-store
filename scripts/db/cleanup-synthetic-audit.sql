-- PROPOSAL — NOT EXECUTED. Targeted, auditable removal of synthetic audit_log rows left by the hosted test runs (2026-11-06).
-- Safe by construction: it can only delete the explicitly listed ids, only if every row still matches its recorded checksum, only if the
-- synthetic users it refers to no longer exist, and it records its own action in audit_log. Any failed guard aborts the whole transaction.
-- Review the list in docs/implementation/AUDIT_CLEANUP_PROPOSAL.md first. Run it manually (SQL editor) right before launch.
begin;

create temp table _expected (id bigint primary key, row_md5 text not null, synthetic_user uuid not null) on commit drop;
insert into _expected (id, row_md5, synthetic_user) values
  (1,  '3afa2329559d0fcadb1d1fdf2893be29', '5d1f4582-f349-4124-b7f4-f18223bb6ad4'),
  (6,  'b018d362fac13bceda3f43f657a1572d', '5d1f4582-f349-4124-b7f4-f18223bb6ad4'),
  (7,  '3089105d380cd96907daf8ba0225242e', '668234c9-5ff4-42a3-b1f2-081a82d9bc1f'),
  (12, '00d0a5e886210fb69fac322eb0ba92f8', '668234c9-5ff4-42a3-b1f2-081a82d9bc1f'),
  (13, '088bb0589b8ecd336560ffdcd6d23a39', '4658d5b9-92c2-4a19-92e4-c54049dfc9ab'),
  (32, 'f6982262fd0449ad97bd4a8dc02641a7', '4658d5b9-92c2-4a19-92e4-c54049dfc9ab'),
  (33, 'd2f920928b1aea2ad4eefc0fd1858980', '8484f422-bea2-42a6-825f-b0e9940bb9dc'),
  (52, '92bb76c9a8dd07b64d839d280a90393f', '8484f422-bea2-42a6-825f-b0e9940bb9dc'),
  (53, '93c82da97f10083584e88a4b3a8f1a01', 'f8d993b7-4731-4150-87a9-04c9c725ba1b'),
  (58, '242459f37a35e281b699d7fda414a64f', 'f8d993b7-4731-4150-87a9-04c9c725ba1b');

do $$
declare matched int; total int; alive int; foreign_ref int;
begin
  select count(*) into total from _expected;
  -- guard 1: every listed row exists and is byte-for-byte what was reviewed
  select count(*) into matched from public.audit_log a join _expected e on e.id = a.id
   where md5(row(a.id, a.actor_id, a.action, a.entity, a.entity_id, a.diff, a.created_at)::text) = e.row_md5;
  if matched <> total then raise exception 'refusing: only % of % rows match their recorded checksum', matched, total; end if;
  -- guard 2: they are synthetic admin grant/revoke rows by the service role (no human actor) ...
  select count(*) into foreign_ref from public.audit_log a join _expected e on e.id = a.id
   where not (a.entity = 'user_roles' and a.actor_id is null and a.action in ('insert', 'delete')
              and coalesce(a.diff->'new'->>'user_id', a.diff->'old'->>'user_id') = e.synthetic_user::text);
  if foreign_ref <> 0 then raise exception 'refusing: % rows are not the expected synthetic user_roles events', foreign_ref; end if;
  -- guard 3: ... and the synthetic users are gone (a real account can never be among them)
  select count(*) into alive from auth.users u join _expected e on e.synthetic_user = u.id;
  if alive <> 0 then raise exception 'refusing: % synthetic users still exist', alive; end if;
end $$;

with removed as (delete from public.audit_log a using _expected e where a.id = e.id returning a.id)
insert into public.audit_log (actor_id, action, entity, entity_id, diff)
select null, 'cleanup', 'audit_log', null,
       jsonb_build_object('reason', 'removed synthetic rows created by hosted test runs', 'proposal', 'docs/implementation/AUDIT_CLEANUP_PROPOSAL.md',
                          'deleted_ids', jsonb_agg(id order by id), 'count', count(*))
  from removed;

-- expected result: 1 row inserted (the cleanup record) and 10 deleted
select id, action, entity, diff from public.audit_log where action = 'cleanup' order by id desc limit 1;
commit;
