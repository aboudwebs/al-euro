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
-- 4) ATOMIC FUNCTIONS (called by the server with the service-role key only)
--    Each runs in ONE transaction and locks the rows it changes, so two admins clicking at the
--    same time can never double-decrement stock or double-charge a workshop.
--    User-facing failures are raised as plain Arabic messages (SQLSTATE P0001).
-- ---------------------------------------------------------------------------

-- 4.1) Order status transition: pending -> approved -> shipped -> delivered, or cancelled.
--   approved  : decrement parts.stock; pay_method = 'debt' -> users.debt_balance += total + 'debit' ledger row
--   delivered : referred workshop -> 2% row in marketer_commissions ('available' for sham/cod, 'held' for debt)
--   cancelled : if it was already approved/shipped, stock is restored and a debt order is reversed
--               (balance reduced + a 'payment' ledger row noting the cancellation)
create or replace function public.admin_set_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_note       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o        public.orders%rowtype;
  u        public.users%rowtype;
  m        public.users%rowtype;
  p        public.parts%rowtype;
  r        record;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_total  numeric;
  v_bal    numeric;
  v_comm   numeric;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;

  if p_new_status not in ('pending','approved','shipped','delivered','cancelled') then
    raise exception 'حالة الطلب غير صالحة';
  end if;

  if not (
       (o.status = 'pending'  and p_new_status in ('approved','cancelled'))
    or (o.status = 'approved' and p_new_status in ('shipped','cancelled'))
    or (o.status = 'shipped'  and p_new_status in ('delivered','cancelled'))
  ) then
    raise exception 'لا يمكن تغيير حالة الطلب من «%» إلى «%»', o.status, p_new_status;
  end if;

  v_total := coalesce(o.total_amount, 0);

  -- ---- pending -> approved : take stock, charge debt -------------------------------------------------
  if p_new_status = 'approved' then
    for r in
      select e->>'part_id' as part_id, sum((e->>'qty')::int) as qty
      from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) e
      group by 1 order by 1
    loop
      select * into p from public.parts where id = r.part_id for update;
      if not found then raise exception 'القطعة رقم % لم تعد موجودة في المخزون', r.part_id; end if;
      if coalesce(p.stock, 0) < r.qty then
        raise exception 'المخزون غير كافٍ للقطعة «%» (المتوفر %، المطلوب %)', p.name, coalesce(p.stock, 0), r.qty;
      end if;
      update public.parts set stock = stock - r.qty where id = r.part_id;
    end loop;

    if o.pay_method = 'debt' then
      select * into u from public.users where id = o.user_id for update;
      if not found or u.role <> 'workshop' then raise exception 'حساب الورشة غير موجود'; end if;
      if coalesce(u.debt_limit, 0) <= 0 then raise exception 'لم يُحدَّد سقف دين لهذه الورشة'; end if;
      if coalesce(u.debt_balance, 0) + v_total > u.debt_limit then
        raise exception 'قيمة الطلب تتجاوز سقف الدين المتاح للورشة (المتاح %)',
          greatest(0, u.debt_limit - coalesce(u.debt_balance, 0));
      end if;
      v_bal := coalesce(u.debt_balance, 0) + v_total;
      update public.users set debt_balance = v_bal where id = u.id;
      insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note)
      values (u.id, o.id, 'debit', v_total, v_bal, 'طلب رقم ' || coalesce(o.order_number::text, o.id::text));
    end if;
  end if;

  -- ---- delivered : 2% marketer commission ---------------------------------------------------------------
  if p_new_status = 'delivered' and o.user_role = 'workshop' then
    select * into u from public.users where id = o.user_id;
    if found and nullif(btrim(coalesce(u.referred_by_code, '')), '') is not null then
      select * into m from public.users
       where my_ref_code = u.referred_by_code and role = 'marketer' limit 1;
      if found and not exists (select 1 from public.marketer_commissions where order_id = o.id) then
        v_comm := round(v_total * 0.02, 2);
        if v_comm > 0 then
          insert into public.marketer_commissions
            (marketer_id, workshop_id, order_id, order_amount, commission_amount, status)
          values
            (m.id, u.id, o.id, v_total, v_comm,
             case when o.pay_method = 'debt' then 'held' else 'available' end);
        end if;
      end if;
    end if;
  end if;

  -- ---- cancelled after approval : put stock back, reverse a debt charge -----------------------------
  if p_new_status = 'cancelled' and o.status in ('approved','shipped') then
    for r in
      select e->>'part_id' as part_id, sum((e->>'qty')::int) as qty
      from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) e
      group by 1 order by 1
    loop
      update public.parts set stock = stock + r.qty where id = r.part_id;
    end loop;

    if o.pay_method = 'debt' then
      select * into u from public.users where id = o.user_id for update;
      if found then
        v_bal := greatest(0, coalesce(u.debt_balance, 0) - v_total);
        update public.users set debt_balance = v_bal where id = u.id;
        insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note)
        values (u.id, o.id, 'payment', v_total, v_bal,
                'إلغاء الطلب رقم ' || coalesce(o.order_number::text, o.id::text));
      end if;
    end if;
  end if;

  update public.orders
     set status = p_new_status,
         status_note = case when p_new_status = 'cancelled' then v_note else status_note end
   where id = o.id;

  return jsonb_build_object('ok', true, 'order_id', o.id, 'order_number', o.order_number, 'status', p_new_status);
end $$;

-- 4.2) Record a debt repayment: users.debt_balance -= amount and add a 'payment' ledger row.
--      Held commissions become available only when the workshop's debt balance reaches zero.
create or replace function public.admin_record_debt_payment(
  p_workshop_id uuid,
  p_amount      numeric,
  p_note        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u        public.users%rowtype;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_bal    numeric;
  v_rel    int := 0;
begin
  if v_amount <= 0 then raise exception 'مبلغ التسديد يجب أن يكون أكبر من صفر'; end if;

  select * into u from public.users where id = p_workshop_id and role = 'workshop' for update;
  if not found then raise exception 'الورشة غير موجودة'; end if;
  if v_amount > coalesce(u.debt_balance, 0) then
    raise exception 'مبلغ التسديد أكبر من الدين المستحق (%)', coalesce(u.debt_balance, 0);
  end if;

  v_bal := round(coalesce(u.debt_balance, 0) - v_amount, 2);
  update public.users set debt_balance = v_bal where id = u.id;

  insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note)
  values (u.id, null, 'payment', v_amount, v_bal, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'تسديد دفعة'));

  -- Commissions from debt orders remain held until this workshop's entire balance reaches zero.
  if v_bal = 0 then
    update public.marketer_commissions set status = 'available'
     where workshop_id = u.id and status = 'held';
    get diagnostics v_rel = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'balance_after', v_bal,
    'released_commissions', v_rel
  );
end $$;

-- 4.3) Mark commissions as paid (only rows that are currently 'available').
create or replace function public.admin_mark_commissions_paid(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'لم يتم اختيار أي عمولة'; end if;
  update public.marketer_commissions set status = 'paid'
   where id = any(p_ids) and status = 'available';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'paid', v_n);
end $$;

-- 4.4) Everything the /admin overview page needs, in one round trip.
create or replace function public.admin_overview(p_low_stock int default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'revenue_total',       coalesce((select sum(total_amount) from public.orders where status in ('approved','shipped','delivered')), 0),
    'revenue_30d',         coalesce((select sum(total_amount) from public.orders where status in ('approved','shipped','delivered') and created_at >= now() - interval '30 days'), 0),
    'pending_orders',      (select count(*) from public.orders where status = 'pending'),
    'pending_sham',        (select count(*) from public.orders where status = 'pending' and pay_method = 'sham'),
    'pending_activations', (select count(*) from public.users where is_active = false and role in ('workshop','marketer')),
    'total_debt',          coalesce((select sum(debt_balance) from public.users where role = 'workshop'), 0),
    'new_requests',        (select count(*) from public.special_requests where status = 'new'),
    'available_commissions', coalesce((select sum(commission_amount) from public.marketer_commissions where status = 'available'), 0),
    'held_commissions',    coalesce((select sum(commission_amount) from public.marketer_commissions where status = 'held'), 0),
    'low_stock_threshold', p_low_stock,
    'branches', coalesce((
      select jsonb_agg(b order by b->>'branch') from (
        select jsonb_build_object(
          'branch',      coalesce(nullif(btrim(branch), ''), 'بدون فرع'),
          'parts_count', count(*),
          'total_stock', coalesce(sum(stock), 0),
          'stock_value', coalesce(sum(stock * price), 0),
          'low_count',   count(*) filter (where stock <= p_low_stock)
        ) as b
        from public.parts where is_active
        group by coalesce(nullif(btrim(branch), ''), 'بدون فرع')
      ) x), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(l) from (
        select jsonb_build_object('id', id, 'name', name, 'brand', brand,
                                  'branch', coalesce(nullif(btrim(branch), ''), 'بدون فرع'), 'stock', stock) as l
        from public.parts where is_active and stock <= p_low_stock
        order by stock, name limit 50
      ) y), '[]'::jsonb)
  );
$$;

-- Only the server (service_role) may call these.
revoke all on function public.admin_set_order_status(uuid, text, text)        from public, anon, authenticated;
revoke all on function public.admin_record_debt_payment(uuid, numeric, text)  from public, anon, authenticated;
revoke all on function public.admin_mark_commissions_paid(uuid[])             from public, anon, authenticated;
revoke all on function public.admin_overview(int)                             from public, anon, authenticated;
grant execute on function public.admin_set_order_status(uuid, text, text)       to service_role;
grant execute on function public.admin_record_debt_payment(uuid, numeric, text) to service_role;
grant execute on function public.admin_mark_commissions_paid(uuid[])            to service_role;
grant execute on function public.admin_overview(int)                            to service_role;

-- ---------------------------------------------------------------------------
-- 5) Seed: the 8 demo parts - ONLY when `parts` is empty.
--    model / years are blank and branch is a placeholder: edit them from /admin/parts.
-- ---------------------------------------------------------------------------
insert into public.parts (id, name, brand, model, years, oem_number, alt_grade, price, stock, branch, image_url, is_active, created_at)
select v.* from (values
  ('1', 'فلتر زيت',          'Mercedes-Benz', '', '', 'A2761800009', null::text, 18::numeric,  42, 'الفرع الرئيسي', null::text, true, now()),
  ('2', 'طقم فحمات أمامي',   'BMW',           '', '', '34116761244', null::text, 75::numeric,  15, 'الفرع الرئيسي', null::text, true, now()),
  ('3', 'مضخة مياه',         'Audi',          '', '', '06H121026',   null::text, 95::numeric,   8, 'الفرع الرئيسي', null::text, true, now()),
  ('4', 'مساعد أمامي',       'Range Rover',   '', '', 'LR032049',    null::text, 210::numeric,  5, 'الفرع الرئيسي', null::text, true, now()),
  ('5', 'بوجي إشعال',        'Volkswagen',    '', '', '06K905601',   null::text, 12::numeric,  60, 'الفرع الرئيسي', null::text, true, now()),
  ('6', 'حساس أوكسجين',      'BMW',           '', '', '11787589121', null::text, 64::numeric,   0, 'الفرع الرئيسي', null::text, true, now()),
  ('7', 'فلتر هواء',         'Mercedes-Benz', '', '', 'A2760940004', null::text, 22::numeric,  30, 'الفرع الرئيسي', null::text, true, now()),
  ('8', 'سير مجموعة',        'Audi',          '', '', '06E903137',   null::text, 38::numeric,  12, 'الفرع الرئيسي', null::text, true, now())
) as v(id, name, brand, model, years, oem_number, alt_grade, price, stock, branch, image_url, is_active, created_at)
where not exists (select 1 from public.parts);

-- ---------------------------------------------------------------------------
-- 6) Promote YOUR first admin
--    a) Register a normal marketer account in the app (/login -> marketer tab).
--    b) Replace 09XXXXXXXX with that account's phone and run this statement
--       (with the placeholder it matches nothing and changes nothing).
--    c) Sign in at /admin/login with the same phone and password.
-- ---------------------------------------------------------------------------
update public.users
   set role = 'admin', is_active = true
 where phone = '09XXXXXXXX' and role = 'marketer'
returning id, name, phone, role, is_active;

-- Storage: the private buckets "receipts", "special-requests" and "avatars" and the public bucket
-- "parts-images" are created automatically by the API on first upload.
