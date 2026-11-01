-- EURO checkout: atomic cashback redemption + order idempotency.
-- Run after loyalty_cashback_2026_10.sql.

begin;

alter table public.orders
  add column if not exists cashback_used numeric(12,2) not null default 0,
  add column if not exists amount_due numeric(12,2),
  add column if not exists idempotency_key uuid,
  add column if not exists request_hash text;

update public.orders
set amount_due = greatest(0, round(total_amount - coalesce(cashback_used, 0), 2))
where amount_due is null;

create unique index if not exists orders_user_idempotency_unique
  on public.orders(user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.orders drop constraint if exists orders_pay_method_check;
alter table public.orders add constraint orders_pay_method_check
  check (pay_method = any (array['sham'::text,'cod'::text,'debt'::text,'cashback'::text]));

create table if not exists public.cashback_redemptions (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.users(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  balance_after numeric(12,2) not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);
create index if not exists cashback_redemptions_workshop_created_idx
  on public.cashback_redemptions(workshop_id, created_at desc);
alter table public.cashback_redemptions enable row level security;

create or replace function public.create_workshop_order(
  p_user_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_user_role text,
  p_items jsonb,
  p_total_amount numeric,
  p_pay_method text,
  p_receipt_url text,
  p_delivery_address jsonb,
  p_cashback_used numeric,
  p_idempotency_key uuid,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.users%rowtype;
  existing public.orders%rowtype;
  new_order public.orders%rowtype;
  v_used numeric(12,2) := round(coalesce(p_cashback_used, 0), 2);
  v_total numeric(12,2) := round(coalesce(p_total_amount, 0), 2);
  v_due numeric(12,2);
  v_balance numeric(12,2);
begin
  if p_idempotency_key is null or coalesce(length(p_request_hash), 0) < 32 then
    raise exception 'مفتاح العملية غير صالح';
  end if;
  if p_user_role not in ('workshop','marketer') then raise exception 'نوع الحساب غير مسموح له بالشراء'; end if;
  if v_total <= 0 or v_used < 0 or v_used > v_total then raise exception 'قيمة الطلب أو الكاش باك غير صالحة'; end if;
  if p_pay_method not in ('sham','cod','debt','cashback') then raise exception 'طريقة الدفع غير صالحة'; end if;
  if p_pay_method = 'cashback' and (v_used <> v_total or v_total <= 0) then
    raise exception 'الدفع بالكاش باك يتطلب تغطية كامل قيمة الطلب';
  end if;
  if p_pay_method <> 'cashback' and v_used = v_total then
    raise exception 'يجب تسجيل الطلب كمدفوع بالكامل بالكاش باك';
  end if;

  select * into u from public.users where id = p_user_id for update;
  if not found or not u.is_active or u.role <> p_user_role then raise exception 'الحساب غير موجود أو غير مفعّل'; end if;

  select * into existing from public.orders where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if existing.request_hash is distinct from p_request_hash then
      raise exception 'مفتاح التأكيد مستخدم لطلب مختلف. حدّث طلباتك قبل المحاولة مجدداً';
    end if;
    return jsonb_build_object('ok',true,'created',false,'orderId',existing.id,
      'orderNumber',existing.order_number,'pay',existing.pay_method,'total',existing.total_amount,
      'cashbackUsed',existing.cashback_used,'amountDue',coalesce(existing.amount_due,existing.total_amount-existing.cashback_used));
  end if;

  if v_used > 0 and p_user_role <> 'workshop' then raise exception 'استخدام الكاش باك متاح لحسابات الورشات فقط'; end if;
  if v_used > coalesce(u.cashback_balance,0) then raise exception 'رصيد الكاش باك المتاح غير كافٍ. حدّث الرصيد وحاول مجدداً'; end if;
  v_due := round(v_total-v_used,2);
  if p_pay_method = 'debt' then
    if p_user_role <> 'workshop' then raise exception 'الدفع بالدين متاح للورشات فقط'; end if;
    if coalesce(u.debt_limit,0) <= 0 then raise exception 'لم يُحدَّد سقف دين لحسابك بعد'; end if;
    if v_due + coalesce(u.debt_balance,0) > u.debt_limit then raise exception 'قيمة الطلب المتبقية تتجاوز سقف الدين المتاح'; end if;
  end if;
  if p_pay_method = 'sham' and v_due > 0 and p_receipt_url is null then raise exception 'يرجى إرفاق إشعار تحويل شام كاش'; end if;

  insert into public.orders(user_id,customer_name,customer_phone,user_role,items,total_amount,pay_method,
    receipt_url,status,delivery_address,cashback_used,amount_due,idempotency_key,request_hash)
  values(p_user_id,p_customer_name,p_customer_phone,p_user_role,p_items,v_total,p_pay_method,
    p_receipt_url,'pending',p_delivery_address,v_used,v_due,p_idempotency_key,p_request_hash)
  returning * into new_order;

  if v_used > 0 then
    v_balance := round(coalesce(u.cashback_balance,0)-v_used,2);
    update public.users set cashback_balance=v_balance where id=p_user_id;
    insert into public.cashback_redemptions(workshop_id,order_id,amount,balance_after)
    values(p_user_id,new_order.id,v_used,v_balance);
  end if;

  return jsonb_build_object('ok',true,'created',true,'orderId',new_order.id,
    'orderNumber',new_order.order_number,'pay',new_order.pay_method,'total',new_order.total_amount,
    'cashbackUsed',new_order.cashback_used,'amountDue',new_order.amount_due);
end;
$$;

revoke all on function public.create_workshop_order(uuid,text,text,text,jsonb,numeric,text,text,jsonb,numeric,uuid,text)
  from public, anon, authenticated;
grant execute on function public.create_workshop_order(uuid,text,text,text,jsonb,numeric,text,text,jsonb,numeric,uuid,text)
  to service_role;

commit;
