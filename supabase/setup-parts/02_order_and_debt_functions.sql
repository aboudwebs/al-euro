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

-- 4.2) Record a debt repayment: users.debt_balance -= amount, 'payment' ledger row,
--      and every 'held' commission of that workshop becomes 'available'.
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
  v_rel    int;
begin
  if v_amount <= 0 then raise exception 'مبلغ التسديد يجب أن يكون أكبر من صفر'; end if;

  select * into u from public.users where id = p_workshop_id and role = 'workshop' for update;
  if not found then raise exception 'الورشة غير موجودة'; end if;
  if v_amount > coalesce(u.debt_balance, 0) then
    raise exception 'مبلغ التسديد أكبر من الدين المستحق (%)', coalesce(u.debt_balance, 0);
  end if;

  v_bal := coalesce(u.debt_balance, 0) - v_amount;
  update public.users set debt_balance = v_bal where id = u.id;

  insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note)
  values (u.id, null, 'payment', v_amount, v_bal, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'تسديد دفعة'));

  update public.marketer_commissions set status = 'available'
   where workshop_id = u.id and status = 'held';
  get diagnostics v_rel = row_count;

  return jsonb_build_object('ok', true, 'balance_after', v_bal, 'released_commissions', v_rel);
end $$;
