-- EURO: server-side workshop loyalty + cashback.
-- Run once in Supabase SQL Editor AFTER the existing setup files.
-- Safe to re-run: columns, table, indexes and function definitions are idempotent.

begin;

alter table public.users
  add column if not exists loyalty_season_started_at timestamptz,
  add column if not exists loyalty_season_spend numeric(12,2) not null default 0;

-- Loyalty tiers are calculated from eligible purchases in the active 90-day season.
alter table public.users drop constraint if exists users_tier_check;
alter table public.users
  add constraint users_tier_check
  check (tier in ('Bronze', 'Silver', 'Gold', 'Platinum', 'VIP'));

alter table public.debt_ledger add column if not exists idempotency_key uuid;
create unique index if not exists debt_ledger_workshop_idempotency_unique
  on public.debt_ledger(workshop_id,idempotency_key)
  where idempotency_key is not null;

alter table public.special_requests
  add column if not exists idempotency_key uuid,
  add column if not exists request_hash text;
create unique index if not exists special_requests_user_idempotency_unique
  on public.special_requests(user_id,idempotency_key)
  where idempotency_key is not null;

create table if not exists public.cashback_ledger (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.users(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  season_started_at timestamptz not null,
  purchase_amount numeric(12,2) not null check (purchase_amount > 0),
  cashback_rate numeric(5,4) not null check (cashback_rate between 0 and 1),
  cashback_amount numeric(12,2) not null check (cashback_amount >= 0),
  status text not null default 'available' check (status in ('held', 'available')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  constraint cashback_ledger_order_unique unique (order_id)
);

create index if not exists cashback_ledger_workshop_created_idx
  on public.cashback_ledger (workshop_id, created_at desc);
create index if not exists cashback_ledger_workshop_status_idx
  on public.cashback_ledger (workshop_id, status);

alter table public.cashback_ledger enable row level security;

-- Delivered orders update season progress, tier and cashback atomically.
-- Cashback uses the tier held BEFORE this order; any tier reached by this order applies to the NEXT order.
create table if not exists public.cashback_refunds (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.users(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  balance_after numeric(12,2) not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);
create index if not exists cashback_refunds_workshop_created_idx
  on public.cashback_refunds(workshop_id, created_at desc);
alter table public.cashback_refunds enable row level security;

create or replace function public.admin_set_order_status(
  p_order_id uuid,
  p_new_status text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  u public.users%rowtype;
  m public.users%rowtype;
  p public.parts%rowtype;
  r record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_total numeric(12,2);
  v_due numeric(12,2);
  v_bal numeric(12,2);
  v_comm numeric(12,2);
  v_season_start timestamptz;
  v_spend_before numeric(12,2);
  v_spend_after numeric(12,2);
  v_rate numeric(5,4);
  v_tier text;
  v_cashback numeric(12,2);
  v_cashback_status text;
  v_reversed_debt_cashback numeric(12,2) := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;

  if p_new_status not in ('pending','approved','shipped','delivered','cancelled') then
    raise exception 'حالة الطلب غير صالحة';
  end if;

  if not (
       (o.status = 'pending' and p_new_status in ('approved','cancelled'))
    or (o.status = 'approved' and p_new_status in ('shipped','cancelled'))
    or (o.status = 'shipped' and p_new_status in ('delivered','cancelled'))
  ) then
    raise exception 'لا يمكن تغيير حالة الطلب من «%» إلى «%»', o.status, p_new_status;
  end if;

  v_total := round(coalesce(o.total_amount, 0), 2);
  v_due := greatest(0, round(coalesce(o.amount_due, v_total - coalesce(o.cashback_used, 0)), 2));

  -- pending -> approved: reserve stock and, for debt orders, charge the workshop.
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
      if coalesce(u.debt_balance, 0) + v_due > u.debt_limit then
        raise exception 'قيمة الطلب تتجاوز سقف الدين المتاح للورشة (المتاح %)',
          greatest(0, u.debt_limit - coalesce(u.debt_balance, 0));
      end if;
      v_bal := round(coalesce(u.debt_balance, 0) + v_due, 2);
      update public.users set debt_balance = v_bal where id = u.id;
      insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note)
      values (u.id, o.id, 'debit', v_due, v_bal, 'طلب رقم ' || coalesce(o.order_number::text, o.id::text));
    end if;
  end if;

  -- delivered: calculate the workshop's tier and cashback from the active 90-day season.
  if p_new_status = 'delivered' and o.user_role = 'workshop' and v_total > 0 then
    select * into u from public.users where id = o.user_id and role = 'workshop' for update;
    if found then
      if u.loyalty_season_started_at is null
         or now() >= u.loyalty_season_started_at + interval '90 days' then
        v_season_start := now();
        v_spend_before := 0;
      else
        v_season_start := u.loyalty_season_started_at;
        v_spend_before := coalesce(u.loyalty_season_spend, 0);
      end if;

      v_spend_after := round(v_spend_before + v_total, 2);

      -- Cashback rate is based on the tier BEFORE this order.
      -- The tier reached after counting this order becomes active on the NEXT order.
      v_rate := case
        when v_spend_before >= 4000 then 0.10
        when v_spend_before >= 3000 then 0.08
        when v_spend_before >= 2000 then 0.06
        when v_spend_before >= 1000 then 0.04
        else 0.02
      end;
      v_tier := case
        when v_spend_after >= 4000 then 'VIP'
        when v_spend_after >= 3000 then 'Platinum'
        when v_spend_after >= 2000 then 'Gold'
        when v_spend_after >= 1000 then 'Silver'
        else 'Bronze'
      end;
      v_cashback := round(greatest(0, v_total - coalesce(o.cashback_used, 0)) * v_rate, 2);
      v_cashback_status := case
        when o.pay_method = 'debt' and coalesce(u.debt_balance, 0) > 0 then 'held'
        else 'available'
      end;

      update public.users
         set loyalty_season_started_at = v_season_start,
             loyalty_season_spend = v_spend_after,
             tier = v_tier,
             cashback_balance = coalesce(cashback_balance, 0)
               + case when v_cashback_status = 'available' then v_cashback else 0 end
       where id = u.id;

      insert into public.cashback_ledger
        (workshop_id, order_id, season_started_at, purchase_amount, cashback_rate, cashback_amount, status)
      values
        (u.id, o.id, v_season_start, v_total, v_rate, v_cashback, v_cashback_status);

      -- Marketer commission: retain the existing 2% rule and debt hold.
      if nullif(btrim(coalesce(u.referred_by_code, '')), '') is not null then
        select * into m from public.users
         where my_ref_code = u.referred_by_code and role = 'marketer' limit 1;
        if found and not exists (
          select 1 from public.marketer_commissions where order_id = o.id
        ) then
          v_comm := round(v_total * 0.02, 2);
          if v_comm > 0 then
            insert into public.marketer_commissions
              (marketer_id, workshop_id, order_id, order_amount, commission_amount, status)
            values
              (m.id, u.id, o.id, v_total, v_comm,
               case when o.pay_method = 'debt' and coalesce(u.debt_balance, 0) > 0 then 'held' else 'available' end);
          end if;
        end if;
      end if;
    end if;
  end if;

  -- cancelled after approval: restore stock and reverse the debt charge.
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
        v_bal := greatest(0, coalesce(u.debt_balance, 0) - v_due);
        update public.users set debt_balance = v_bal where id = u.id;
        insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note)
        values (u.id, o.id, 'payment', v_due, v_bal,
                'إلغاء الطلب رقم ' || coalesce(o.order_number::text, o.id::text));

        -- A cancellation can clear the final outstanding debt just like a repayment.
        if v_bal = 0 then
          update public.marketer_commissions
             set status = 'available'
           where workshop_id = u.id and status = 'held';

          with released as (
            update public.cashback_ledger
               set status = 'available', released_at = now()
             where workshop_id = u.id and status = 'held'
             returning cashback_amount
          )
          select coalesce(sum(cashback_amount), 0)::numeric(12,2)
            into v_reversed_debt_cashback
            from released;

          if v_reversed_debt_cashback > 0 then
            update public.users
               set cashback_balance = coalesce(cashback_balance, 0) + v_reversed_debt_cashback
             where id = u.id;
          end if;
        end if;
      end if;
    end if;
  end if;

  -- Refund any cashback used on this order if it is cancelled, including while still pending.
  if p_new_status = 'cancelled' and coalesce(o.cashback_used, 0) > 0 then
    select * into u from public.users where id = o.user_id for update;
    if found and not exists (
      select 1 from public.cashback_refunds where order_id = o.id
    ) then
      update public.users
         set cashback_balance = coalesce(cashback_balance, 0) + o.cashback_used
       where id = u.id;
      insert into public.cashback_refunds(workshop_id, order_id, amount, balance_after)
      values (u.id, o.id, o.cashback_used,
              (select cashback_balance from public.users where id = u.id));
    end if;
  end if;

  update public.orders
     set status = p_new_status,
         status_note = case when p_new_status = 'cancelled' then v_note else status_note end
   where id = o.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', o.id,
    'order_number', o.order_number,
    'status', p_new_status
  );
end;
$$;

-- Debt cashback stays held until the workshop's TOTAL debt balance reaches zero.
-- At that point both held cashback and held marketer commissions are released once.
create or replace function public.admin_record_debt_payment(
  p_workshop_id uuid,
  p_amount numeric,
  p_note text default null,
  p_idempotency_key uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.users%rowtype;
  previous public.debt_ledger%rowtype;
  v_amount numeric(12,2) := round(coalesce(p_amount, 0), 2);
  v_bal numeric(12,2);
  v_rel int := 0;
  v_cashback_release numeric(12,2) := 0;
  v_note text := coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'تسديد دفعة');
begin
  if p_idempotency_key is null then raise exception 'مفتاح التأكيد مطلوب'; end if;
  if v_amount <= 0 then raise exception 'مبلغ التسديد يجب أن يكون أكبر من صفر'; end if;

  select * into u from public.users where id = p_workshop_id and role = 'workshop' for update;
  if not found then raise exception 'الورشة غير موجودة'; end if;

  select * into previous from public.debt_ledger
   where workshop_id = u.id and idempotency_key = p_idempotency_key;
  if found then
    if previous.amount <> v_amount or coalesce(previous.note,'') <> v_note then
      raise exception 'مفتاح التأكيد مستخدم لتسديد مختلف';
    end if;
    return jsonb_build_object('ok',true,'duplicate',true,
      'balance_after',previous.balance_after,'released_commissions',0);
  end if;

  if v_amount > coalesce(u.debt_balance, 0) then
    raise exception 'مبلغ التسديد أكبر من الدين المستحق (%)', coalesce(u.debt_balance, 0);
  end if;

  v_bal := round(coalesce(u.debt_balance, 0) - v_amount, 2);
  update public.users set debt_balance = v_bal where id = u.id;

  insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note, idempotency_key)
  values (u.id, null, 'payment', v_amount, v_bal, v_note, p_idempotency_key);

  if v_bal = 0 then
    update public.marketer_commissions set status = 'available'
     where workshop_id = u.id and status = 'held';
    get diagnostics v_rel = row_count;

    with released as (
      update public.cashback_ledger set status = 'available', released_at = now()
       where workshop_id = u.id and status = 'held'
       returning cashback_amount
    )
    select coalesce(sum(cashback_amount), 0)::numeric(12,2)
      into v_cashback_release
      from released;

    if v_cashback_release > 0 then
      update public.users set cashback_balance = coalesce(cashback_balance, 0) + v_cashback_release
       where id = u.id;
    end if;
  end if;

  return jsonb_build_object('ok',true,'duplicate',false,'balance_after',v_bal,'released_commissions',v_rel);
end;
$$;

revoke all on function public.admin_set_order_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_record_debt_payment(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_set_order_status(uuid, text, text) to service_role;
grant execute on function public.admin_record_debt_payment(uuid, numeric, text) to service_role;

commit;

-- Read-only verification after running:
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'users'
--   and column_name in ('loyalty_season_started_at','loyalty_season_spend');
-- select tier, count(*) from public.users where role = 'workshop' group by tier order by tier;
-- select status, count(*), sum(cashback_amount) from public.cashback_ledger group by status;
