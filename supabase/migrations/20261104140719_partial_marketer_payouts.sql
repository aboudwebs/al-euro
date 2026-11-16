-- Partial marketer payouts with optional delivery details.
drop function if exists public.request_marketer_payout(uuid,text);
alter table public.marketer_payout_requests
  alter column payout_details drop not null;

alter table public.marketer_payout_requests
  drop constraint if exists marketer_payout_requests_payout_details_check;

create table if not exists public.marketer_payout_allocations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.marketer_payout_requests(id) on delete cascade,
  commission_id uuid not null references public.marketer_commissions(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','paid','released')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (request_id, commission_id)
);
create index if not exists marketer_payout_allocations_commission_status_idx
  on public.marketer_payout_allocations(commission_id, status);
create index if not exists marketer_payout_allocations_request_idx
  on public.marketer_payout_allocations(request_id);

create or replace function public.request_marketer_payout(
  p_marketer_id uuid, p_amount numeric, p_payout_details text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user public.users%rowtype;
  v_commission public.marketer_commissions%rowtype;
  v_request public.marketer_payout_requests%rowtype;
  v_remaining numeric(12,2);
  v_reserved numeric(12,2);
  v_take numeric(12,2);
  v_left numeric(12,2);
  v_ids uuid[] := array[]::uuid[];
  v_count integer := 0;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'مبلغ السحب غير صالح';
  end if;
  if char_length(coalesce(p_payout_details,'')) > 1000 then
    raise exception 'معلومات السحب طويلة جداً';
  end if;
  select * into v_user from public.users
   where id = p_marketer_id and role = 'marketer' and is_active = true for update;
  if not found then raise exception 'حساب المسوّق غير موجود أو غير مفعّل'; end if;
  if exists (select 1 from public.marketer_payout_requests
              where marketer_id = p_marketer_id and status = 'pending') then
    raise exception 'لديك طلب سحب قيد المراجعة بالفعل';
  end if;

  v_left := p_amount;
  for v_commission in
    select * from public.marketer_commissions
     where marketer_id = p_marketer_id and status in ('available','payout_requested')
     order by created_at, id for update
  loop
    select coalesce(sum(a.amount),0) into v_reserved
      from public.marketer_payout_allocations a
     where a.commission_id = v_commission.id and a.status in ('pending','paid');
    if v_commission.status = 'payout_requested'
       and not exists (select 1 from public.marketer_payout_allocations a where a.commission_id = v_commission.id) then
      continue;
    end if;
    v_remaining := round(v_commission.commission_amount - v_reserved, 2);
    if v_remaining <= 0 then continue; end if;
    v_take := least(v_remaining, v_left);
    if v_take > 0 then
      v_ids := array_append(v_ids, v_commission.id);
      v_left := round(v_left - v_take, 2);
      exit when v_left <= 0;
    end if;
  end loop;
  if v_left > 0 then raise exception 'رصيد العمولات المتاح أقل من المبلغ المطلوب'; end if;

  insert into public.marketer_payout_requests(marketer_id, amount, commission_ids, payout_details)
  values (p_marketer_id, p_amount, v_ids, nullif(btrim(coalesce(p_payout_details,'')), ''))
  returning * into v_request;

  v_left := p_amount;
  foreach v_commission.id in array v_ids loop
    select * into v_commission from public.marketer_commissions where id = v_commission.id;
    select coalesce(sum(a.amount),0) into v_reserved
      from public.marketer_payout_allocations a
     where a.commission_id = v_commission.id and a.status in ('pending','paid');
    v_remaining := round(v_commission.commission_amount - v_reserved, 2);
    v_take := least(v_remaining, v_left);
    insert into public.marketer_payout_allocations(request_id, commission_id, amount)
    values (v_request.id, v_commission.id, v_take);
    update public.marketer_commissions set status = 'payout_requested' where id = v_commission.id;
    v_left := round(v_left - v_take, 2);
    v_count := v_count + 1;
    exit when v_left <= 0;
  end loop;
  if v_left <> 0 or v_count <> cardinality(v_ids) then raise exception 'تعذر تخصيص مبلغ السحب للعمولات'; end if;
  return jsonb_build_object('ok',true,'id',v_request.id,'amount',v_request.amount,'status',v_request.status);
end;
$function$;

create or replace function public.admin_process_marketer_payout(
  p_request_id uuid, p_action text, p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_request public.marketer_payout_requests%rowtype;
  v_count integer;
  v_target_status text;
begin
  if p_action not in ('paid','rejected') then raise exception 'الإجراء غير صالح'; end if;
  select * into v_request from public.marketer_payout_requests where id = p_request_id for update;
  if not found then raise exception 'طلب السحب غير موجود'; end if;
  if v_request.status <> 'pending' then raise exception 'تمت معالجة طلب السحب مسبقاً'; end if;
  v_target_status := case when p_action = 'paid' then 'paid' else 'released' end;
  update public.marketer_payout_allocations
     set status = v_target_status, processed_at = now()
   where request_id = v_request.id and status = 'pending';
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_request.commission_ids) then raise exception 'تعذر مطابقة العمولات المرتبطة بطلب السحب'; end if;

  update public.marketer_commissions mc
     set status = case
       when coalesce((select sum(a.amount) from public.marketer_payout_allocations a
                       where a.commission_id = mc.id and a.status = 'paid'),0) >= mc.commission_amount then 'paid'
       when exists (select 1 from public.marketer_payout_allocations a
                     where a.commission_id = mc.id and a.status = 'pending') then 'payout_requested'
       else 'available'
     end
   where mc.id = any(v_request.commission_ids);
  update public.marketer_payout_requests
     set status = p_action, admin_note = nullif(btrim(coalesce(p_admin_note,'')),''),
         processed_at = now()
   where id = v_request.id;
  return jsonb_build_object('ok',true,'id',v_request.id,'status',p_action,'amount',v_request.amount);
end;
$function$;

revoke all on function public.request_marketer_payout(uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.admin_process_marketer_payout(uuid,text,text) from public, anon, authenticated;
grant execute on function public.request_marketer_payout(uuid,numeric,text) to service_role;
grant execute on function public.admin_process_marketer_payout(uuid,text,text) to service_role;
alter table public.marketer_payout_allocations enable row level security;
revoke all on public.marketer_payout_allocations from anon, authenticated;
