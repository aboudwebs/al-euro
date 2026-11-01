-- Keep cashback and referral commissions held while ANY workshop debt remains.
-- Add an auditable manual-refund state for cancelled Sham Cash orders.

alter table public.orders
  add column if not exists refund_status text not null default 'not_required',
  add column if not exists refund_note text,
  add column if not exists refunded_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.orders'::regclass and conname='orders_refund_status_check'
  ) then
    alter table public.orders
      add constraint orders_refund_status_check
      check (refund_status in ('not_required','pending_review','refunded','not_refundable'));
  end if;
end $$;

create index if not exists orders_refund_review_idx
  on public.orders (created_at desc)
  where refund_status = 'pending_review';

update public.orders
   set refund_status = 'pending_review'
 where status = 'cancelled'
   and pay_method = 'sham'
   and nullif(btrim(coalesce(receipt_url,'')), '') is not null
   and refund_status = 'not_required';

do $$
declare
  v_def text;
  v_reward_old text := 'when o.pay_method = ''debt'' and coalesce(u.debt_balance, 0) > 0 then ''held''';
  v_reward_new text := 'when coalesce(u.debt_balance, 0) > 0 then ''held''';
  v_order_update_old text := E'  update public.orders\n     set status = p_new_status,\n         status_note = case when p_new_status = ''cancelled'' then v_note else status_note end\n   where id = o.id;';
  v_order_update_new text := E'  update public.orders\n     set status = p_new_status,\n         status_note = case when p_new_status = ''cancelled'' then v_note else status_note end,\n         refund_status = case\n           when p_new_status = ''cancelled'' and o.pay_method = ''sham''\n             and nullif(btrim(coalesce(o.receipt_url, '''')), '''') is not null\n             then ''pending_review''\n           else refund_status\n         end\n   where id = o.id;';
  v_count integer;
begin
  v_def := pg_get_functiondef('public.admin_set_order_status(uuid,text,text)'::regprocedure);
  v_count := (length(v_def) - length(replace(v_def, v_reward_old, ''))) / length(v_reward_old);
  if v_count <> 2 then
    raise exception 'Expected exactly 2 reward hold expressions, found %', v_count;
  end if;
  v_def := replace(v_def, v_reward_old, v_reward_new);
  if position(v_order_update_old in v_def) = 0 then
    raise exception 'Could not locate the final orders update in admin_set_order_status';
  end if;
  v_def := replace(v_def, v_order_update_old, v_order_update_new);
  execute v_def;
end $$;

create or replace function public.admin_update_sham_refund_status(
  p_order_id uuid,
  p_new_status text,
  p_note text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor public.users%rowtype;
  v_order public.orders%rowtype;
  v_note text := nullif(btrim(coalesce(p_note,'')), '');
begin
  if p_new_status not in ('refunded','not_refundable') then
    raise exception 'حالة الاسترداد غير صالحة';
  end if;

  select * into v_actor
    from public.users
   where id = p_actor_id and role = 'admin' and is_active = true;
  if not found then
    raise exception 'غير مصرح: هذه العملية للإدارة فقط';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id
   for update;
  if not found then
    raise exception 'الطلب غير موجود';
  end if;
  if v_order.pay_method <> 'sham' or v_order.status <> 'cancelled'
     or nullif(btrim(coalesce(v_order.receipt_url,'')), '') is null then
    raise exception 'هذا الطلب لا يحتاج إلى معالجة استرداد شام كاش';
  end if;

  if v_order.refund_status = p_new_status then
    return jsonb_build_object('ok',true,'duplicate',true,'status',p_new_status);
  end if;
  if v_order.refund_status <> 'pending_review' then
    raise exception 'تمت معالجة استرداد هذا الطلب مسبقاً';
  end if;
  if p_new_status = 'not_refundable' and length(coalesce(v_note,'')) < 3 then
    raise exception 'يرجى توضيح سبب عدم الاسترداد';
  end if;

  update public.orders
     set refund_status = p_new_status,
         refund_note = v_note,
         refunded_at = case when p_new_status = 'refunded' then now() else null end
   where id = v_order.id;

  insert into public.user_notifications(user_id,type,title,body,order_id)
  values(
    v_order.user_id,
    'payment',
    case when p_new_status = 'refunded' then 'تم تأكيد استرداد دفعة شام كاش' else 'تمت مراجعة استرداد دفعة شام كاش' end,
    case when p_new_status = 'refunded'
      then 'أكدت الإدارة إعادة مبلغ الطلب رقم ' || coalesce(v_order.order_number::text,'—') || ' عبر شام كاش.'
      else 'راجعت الإدارة طلب استرداد الطلب رقم ' || coalesce(v_order.order_number::text,'—') || '. ' || coalesce(v_note,'')
    end,
    v_order.id
  );

  return jsonb_build_object('ok',true,'duplicate',false,'status',p_new_status,'order_id',v_order.id);
end;
$function$;

revoke all on function public.admin_update_sham_refund_status(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.admin_update_sham_refund_status(uuid,text,text,uuid) to service_role;
