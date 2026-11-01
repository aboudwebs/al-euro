-- EURO idempotency protections for customer-created records and admin debt repayments.
-- Safe to re-run.

begin;
alter table public.special_requests
  add column if not exists idempotency_key uuid,
  add column if not exists request_hash text;
create unique index if not exists special_requests_user_idempotency_unique
  on public.special_requests(user_id,idempotency_key)
  where idempotency_key is not null;

alter table public.user_addresses
  add column if not exists idempotency_key uuid,
  add column if not exists request_hash text;
create unique index if not exists user_addresses_user_idempotency_unique
  on public.user_addresses(user_id,idempotency_key)
  where idempotency_key is not null;

alter table public.user_vehicles
  add column if not exists idempotency_key uuid,
  add column if not exists request_hash text;
create unique index if not exists user_vehicles_user_idempotency_unique
  on public.user_vehicles(user_id,idempotency_key)
  where idempotency_key is not null;

alter table public.debt_ledger add column if not exists idempotency_key uuid;
create unique index if not exists debt_ledger_workshop_idempotency_unique
  on public.debt_ledger(workshop_id,idempotency_key)
  where idempotency_key is not null;
commit;

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
      into v_cashback_release from released;
    if v_cashback_release > 0 then
      update public.users set cashback_balance = coalesce(cashback_balance, 0) + v_cashback_release
       where id = u.id;
    end if;
  end if;

  return jsonb_build_object('ok',true,'duplicate',false,'balance_after',v_bal,'released_commissions',v_rel);
end;
$$;

revoke all on function public.admin_record_debt_payment(uuid,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_record_debt_payment(uuid,numeric,text,uuid) to service_role;
