-- EURO final loyalty cashback tiers (90-day season, including VIP 15%).
-- Apply AFTER loyalty_cashback_2026_10.sql. Safe to re-run.

begin;

alter table public.users drop constraint if exists users_tier_check;

-- Recalculate the displayed tier from each workshop's current season spend.
update public.users
set tier = case
  when coalesce(loyalty_season_spend, 0) >= 50000 then 'VIP'
  when coalesce(loyalty_season_spend, 0) >= 30000 then 'Platinum'
  when coalesce(loyalty_season_spend, 0) >= 20000 then 'Gold'
  when coalesce(loyalty_season_spend, 0) >= 15000 then 'Silver'
  when coalesce(loyalty_season_spend, 0) >= 10000 then 'Bronze'
  else 'Standard'
end
where role = 'workshop';

alter table public.users
  add constraint users_tier_check
  check (tier in ('Standard', 'Bronze', 'Silver', 'Gold', 'Platinum', 'VIP'));

-- Cashback is based on the tier BEFORE the delivered order.
-- Spend from the delivered order is added afterwards, so any upgrade applies
-- only to the next order. Season length remains 90 days.
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
        when v_spend_before >= 50000 then 0.15
        when v_spend_before >= 30000 then 0.10
        when v_spend_before >= 20000 then 0.07
        when v_spend_before >= 15000 then 0.05
        when v_spend_before >= 10000 then 0.02
        else 0.00
      end;
      v_tier := case
        when v_spend_after >= 50000 then 'VIP'
        when v_spend_after >= 30000 then 'Platinum'
        when v_spend_after >= 20000 then 'Gold'
        when v_spend_after >= 15000 then 'Silver'
        when v_spend_after >= 10000 then 'Bronze'
        else 'Standard'
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


revoke all on function public.admin_set_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_order_status(uuid, text, text) to service_role;

commit;

-- Verify:
-- select tier, count(*) from public.users where role='workshop' group by tier order by tier;
-- select cashback_rate, count(*) from public.cashback_ledger group by cashback_rate order by cashback_rate;
