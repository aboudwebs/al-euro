-- ===========================================================================
-- EURO CARS (اليورو) - FULL SETUP: Phase 1 + Phase 2 (admin dashboard)
-- Run ONCE in the Supabase SQL editor, top to bottom. Idempotent: safe to run again.
--
-- Uses ONLY the 6 existing tables (users, parts, orders, special_requests, debt_ledger,
-- marketer_commissions). No tables are created and no RLS setting is changed.
-- The only new column is public.orders.status_note.
--
-- Sections
--   1) Missing column defaults + orders.status_note
--   2) CHECK constraints aligned with the live schema (+ legacy value migration)
--   3) Indexes
--   4) Atomic functions used by /api/admin/*  (service_role only)
--   5) Seed: 8 demo parts (only when `parts` is empty)
--   6) Promote your first admin
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0) OPTIONAL read-only diagnostics (run separately if something is rejected)
-- ---------------------------------------------------------------------------
--   select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as definition
--   from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace order by 1, 2;

-- ---------------------------------------------------------------------------
-- 1) Column defaults (only where missing) + the new status_note column
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists status_note text;

do $$
declare r record;
begin
  for r in
    select * from (values
      ('users',                'id',               'gen_random_uuid()'),
      ('users',                'created_at',       'now()'),
      ('users',                'debt_limit',       '0'),
      ('users',                'debt_balance',     '0'),
      ('users',                'cashback_balance', '0'),
      ('users',                'tier',             '''Bronze'''),
      ('parts',                'created_at',       'now()'),
      ('parts',                'is_active',        'true'),
      ('parts',                'stock',            '0'),
      ('orders',               'id',               'gen_random_uuid()'),
      ('orders',               'created_at',       'now()'),
      ('special_requests',     'id',               'gen_random_uuid()'),
      ('special_requests',     'created_at',       'now()'),
      ('debt_ledger',          'id',               'gen_random_uuid()'),
      ('debt_ledger',          'created_at',       'now()'),
      ('marketer_commissions', 'id',               'gen_random_uuid()'),
      ('marketer_commissions', 'created_at',       'now()')
    ) as t(tbl, col, expr)
  loop
    if exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = r.tbl and c.column_name = r.col
        and c.column_default is null and c.is_identity = 'NO' and c.is_generated = 'NEVER'
    ) then
      execute format('alter table public.%I alter column %I set default %s', r.tbl, r.col, r.expr);
    end if;
  end loop;
end $$;

-- Status defaults must be values the CHECK constraints accept.
alter table public.orders               alter column status set default 'pending';
alter table public.special_requests     alter column status set default 'new';
alter table public.marketer_commissions alter column status set default 'held';

update public.users set tier = 'Bronze' where tier is null and role = 'workshop';

-- orders.order_number: add a sequence default only if the column has none
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'order_number'
      and column_default is null and is_identity = 'NO'
  ) then
    create sequence if not exists public.orders_order_number_seq owned by public.orders.order_number;
    perform setval('public.orders_order_number_seq', coalesce((select max(order_number) from public.orders), 0) + 1, false);
    alter table public.orders alter column order_number set default nextval('public.orders_order_number_seq');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) CHECK constraints = the live values (re-created idempotently)
--    Legacy values from the very first drafts are migrated first so the re-creation can never fail.
-- ---------------------------------------------------------------------------
update public.orders set status = 'approved'  where status in ('payment_verified', 'preparing');
update public.orders set status = 'shipped'   where status = 'out_for_delivery';
update public.special_requests set status = 'new'       where status = 'pending';
update public.special_requests set status = 'priced'    where status = 'quoted';
update public.special_requests set status = 'ordered'   where status = 'accepted';
update public.special_requests set status = 'cancelled' where status = 'rejected';
update public.debt_ledger set tx_type = 'debit' where tx_type = 'charge';
update public.marketer_commissions set status = 'held' where status = 'pending';

do $$
declare c record;
begin
  for c in
    select * from (values
      ('users',                'users_role_check',                  $d$check (role in ('workshop','marketer','admin'))$d$),
      ('users',                'users_tier_check',                  $d$check (tier in ('Bronze','Silver','Gold'))$d$),
      ('orders',               'orders_pay_method_check',           $d$check (pay_method in ('sham','cod','debt'))$d$),
      ('orders',               'orders_status_check',               $d$check (status in ('pending','approved','shipped','delivered','cancelled'))$d$),
      ('orders',               'orders_user_role_check',            $d$check (user_role in ('workshop','marketer'))$d$),
      ('special_requests',     'special_requests_status_check',     $d$check (status in ('new','priced','ordered','completed','cancelled'))$d$),
      ('debt_ledger',          'debt_ledger_tx_type_check',         $d$check (tx_type in ('debit','payment'))$d$),
      ('marketer_commissions', 'marketer_commissions_status_check', $d$check (status in ('held','available','paid'))$d$)
    ) as t(tbl, name, def)
  loop
    execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.name);
    execute format('alter table public.%I add constraint %I %s', c.tbl, c.name, c.def);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Indexes used by the dashboard queries
-- ---------------------------------------------------------------------------
create index if not exists orders_status_created_idx        on public.orders (status, created_at desc);
create index if not exists orders_pay_status_idx            on public.orders (pay_method, status);
create index if not exists orders_user_idx                  on public.orders (user_id, created_at desc);
create index if not exists debt_ledger_workshop_idx         on public.debt_ledger (workshop_id, created_at desc);
create index if not exists marketer_commissions_status_idx  on public.marketer_commissions (status, created_at desc);
create index if not exists marketer_commissions_workshop_idx on public.marketer_commissions (workshop_id, status);
create index if not exists marketer_commissions_order_idx   on public.marketer_commissions (order_id);
create index if not exists special_requests_status_idx      on public.special_requests (status, created_at desc);

-- ---------------------------------------------------------------------------
