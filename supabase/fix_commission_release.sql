-- EURO CARS: release held marketer commissions only after the workshop fully clears its debt.
-- Safe to run independently in Supabase SQL Editor; replaces one existing function only.
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

revoke all on function public.admin_record_debt_payment(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_record_debt_payment(uuid, numeric, text) to service_role;
