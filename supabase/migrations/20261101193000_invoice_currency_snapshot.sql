-- EURO CARS: immutable invoice-currency snapshots.
-- Apply this migration in Supabase SQL Editor before deploying the matching API build.
begin;

alter table public.orders
  add column if not exists invoice_currency text not null default 'USD',
  add column if not exists invoice_exchange_rate numeric(18,6),
  add column if not exists invoice_total_syp numeric(18,2),
  add column if not exists invoice_cashback_used_syp numeric(18,2),
  add column if not exists invoice_amount_due_syp numeric(18,2);

alter table public.orders drop constraint if exists orders_invoice_currency_check;
alter table public.orders add constraint orders_invoice_currency_check
  check (invoice_currency in ('USD','SYP'));

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
  p_request_hash text,
  p_invoice_currency text,
  p_invoice_exchange_rate numeric,
  p_invoice_total_syp numeric,
  p_invoice_cashback_used_syp numeric,
  p_invoice_amount_due_syp numeric
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
  v_currency text := coalesce(p_invoice_currency, 'USD');
  v_rate numeric(18,6);
  v_total_syp numeric(18,2);
  v_cashback_syp numeric(18,2);
  v_due_syp numeric(18,2);
begin
  if p_idempotency_key is null or coalesce(length(p_request_hash), 0) < 32 then
    raise exception 'مفتاح العملية غير صالح';
  end if;
  if p_user_role not in ('workshop','marketer') then
    raise exception 'نوع الحساب غير مسموح له بالشراء';
  end if;
  if v_total <= 0 or v_used < 0 or v_used > v_total then
    raise exception 'قيمة الطلب أو الكاش باك غير صالحة';
  end if;
  if p_pay_method not in ('sham','cod','debt','cashback') then
    raise exception 'طريقة الدفع غير صالحة';
  end if;
  if v_currency not in ('USD','SYP') then
    raise exception 'عملة الفاتورة غير صالحة';
  end if;

  if v_currency = 'SYP' then
    v_rate := p_invoice_exchange_rate;
    v_total_syp := p_invoice_total_syp;
    v_cashback_syp := p_invoice_cashback_used_syp;
    v_due_syp := p_invoice_amount_due_syp;
    if v_rate is null or v_rate <= 0
       or v_total_syp is null or v_cashback_syp is null or v_due_syp is null then
      raise exception 'لقطة سعر الصرف للفاتورة غير مكتملة';
    end if;
    if v_total_syp <> round(v_total * v_rate, 0)
       or v_cashback_syp <> round(v_used * v_rate, 0)
       or v_due_syp <> round(round(v_total - v_used, 2) * v_rate, 0) then
      raise exception 'قيم الفاتورة بالليرة لا تطابق لقطة سعر الصرف';
    end if;
  else
    v_rate := null;
    v_total_syp := null;
    v_cashback_syp := null;
    v_due_syp := null;
  end if;

  if p_pay_method = 'cashback' and v_used <> v_total then
    raise exception 'الدفع بالكاش باك يتطلب تغطية كامل قيمة الطلب';
  end if;
  if p_pay_method <> 'cashback' and v_used = v_total then
    raise exception 'يجب اختيار الدفع بالكاش باك عند تغطية كامل قيمة الطلب';
  end if;

  select * into u from public.users where id = p_user_id for update;
  if not found or not u.is_active or u.role <> p_user_role then
    raise exception 'الحساب غير موجود أو غير مفعّل';
  end if;

  select * into existing from public.orders
   where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if existing.request_hash is distinct from p_request_hash then
      raise exception 'مفتاح التأكيد مستخدم لطلب مختلف. حدّث طلباتك قبل المحاولة مجدداً';
    end if;
    return jsonb_build_object(
      'ok', true, 'created', false, 'orderId', existing.id,
      'orderNumber', existing.order_number, 'pay', existing.pay_method,
      'total', existing.total_amount, 'cashbackUsed', existing.cashback_used,
      'amountDue', coalesce(existing.amount_due, existing.total_amount - existing.cashback_used),
      'invoiceCurrency', existing.invoice_currency,
      'invoiceExchangeRate', existing.invoice_exchange_rate,
      'invoiceTotalSyp', existing.invoice_total_syp,
      'invoiceCashbackUsedSyp', existing.invoice_cashback_used_syp,
      'invoiceAmountDueSyp', existing.invoice_amount_due_syp
    );
  end if;

  if v_used > 0 and p_user_role <> 'workshop' then
    raise exception 'استخدام الكاش باك متاح لحسابات الورشات فقط';
  end if;
  if v_used > coalesce(u.cashback_balance, 0) then
    raise exception 'رصيد الكاش باك المتاح غير كافٍ. حدّث الرصيد وحاول مجدداً';
  end if;

  v_due := round(v_total - v_used, 2);
  if p_pay_method = 'debt' then
    if p_user_role <> 'workshop' then raise exception 'الدفع بالدين متاح للورشات فقط'; end if;
    if coalesce(u.debt_limit, 0) <= 0 then raise exception 'لم يُحدَّد سقف دين لحسابك بعد'; end if;
    if v_due + coalesce(u.debt_balance, 0) > u.debt_limit then
      raise exception 'قيمة الطلب المتبقية تتجاوز سقف الدين المتاح';
    end if;
  end if;
  if p_pay_method = 'sham' and v_due > 0 and p_receipt_url is null then
    raise exception 'يرجى إرفاق إشعار تحويل شام كاش';
  end if;

  insert into public.orders (
    user_id, customer_name, customer_phone, user_role, items,
    total_amount, pay_method, receipt_url, status, delivery_address,
    cashback_used, amount_due, idempotency_key, request_hash,
    invoice_currency, invoice_exchange_rate, invoice_total_syp,
    invoice_cashback_used_syp, invoice_amount_due_syp
  ) values (
    p_user_id, p_customer_name, p_customer_phone, p_user_role, p_items,
    v_total, p_pay_method, p_receipt_url, 'pending', p_delivery_address,
    v_used, v_due, p_idempotency_key, p_request_hash,
    v_currency, v_rate, v_total_syp, v_cashback_syp, v_due_syp
  )
  returning * into new_order;

  if v_used > 0 then
    v_balance := round(coalesce(u.cashback_balance, 0) - v_used, 2);
    update public.users set cashback_balance = v_balance where id = p_user_id;
    insert into public.cashback_redemptions(workshop_id, order_id, amount, balance_after)
    values (p_user_id, new_order.id, v_used, v_balance);
  end if;

  return jsonb_build_object(
    'ok', true, 'created', true, 'orderId', new_order.id,
    'orderNumber', new_order.order_number, 'pay', new_order.pay_method,
    'total', new_order.total_amount, 'cashbackUsed', new_order.cashback_used,
    'amountDue', new_order.amount_due,
    'invoiceCurrency', new_order.invoice_currency,
    'invoiceExchangeRate', new_order.invoice_exchange_rate,
    'invoiceTotalSyp', new_order.invoice_total_syp,
    'invoiceCashbackUsedSyp', new_order.invoice_cashback_used_syp,
    'invoiceAmountDueSyp', new_order.invoice_amount_due_syp
  );
end;
$$;

revoke all on function public.create_workshop_order(
  uuid,text,text,text,jsonb,numeric,text,text,jsonb,numeric,uuid,text,text,numeric,numeric,numeric,numeric
) from public, anon, authenticated;
grant execute on function public.create_workshop_order(
  uuid,text,text,text,jsonb,numeric,text,text,jsonb,numeric,uuid,text,text,numeric,numeric,numeric,numeric
) to service_role;

commit;
