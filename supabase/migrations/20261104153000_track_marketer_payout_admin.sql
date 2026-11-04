alter table public.marketer_payout_requests
  add column if not exists processed_by uuid references public.users(id);

drop function if exists public.admin_process_marketer_payout(uuid,text,text);

create or replace function public.admin_process_marketer_payout(
  p_request_id uuid,
  p_action text,
  p_admin_note text default null,
  p_admin_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_request public.marketer_payout_requests%rowtype;
  v_count integer;
  v_target_status text;
begin
  if p_action not in ('paid','rejected') then raise exception 'الإجراء غير صالح'; end if;
  if p_admin_id is null or not exists (
    select 1 from public.users where id=p_admin_id and role='admin' and is_active=true
  ) then raise exception 'حساب الإدارة غير صالح'; end if;

  select * into v_request from public.marketer_payout_requests where id=p_request_id for update;
  if not found then raise exception 'طلب السحب غير موجود'; end if;
  if v_request.status <> 'pending' then raise exception 'تمت معالجة طلب السحب مسبقاً'; end if;

  v_target_status := case when p_action='paid' then 'paid' else 'released' end;
  update public.marketer_payout_allocations
     set status=v_target_status, processed_at=now()
   where request_id=v_request.id and status='pending';
  get diagnostics v_count=row_count;
  if v_count <> cardinality(v_request.commission_ids) then
    raise exception 'تعذر مطابقة العمولات المرتبطة بطلب السحب';
  end if;

  update public.marketer_commissions mc
     set status=case
       when coalesce((select sum(a.amount) from public.marketer_payout_allocations a
                       where a.commission_id=mc.id and a.status='paid'),0) >= mc.commission_amount then 'paid'
       when exists (select 1 from public.marketer_payout_allocations a
                     where a.commission_id=mc.id and a.status='pending') then 'payout_requested'
       else 'available'
     end
   where mc.id=any(v_request.commission_ids);

  update public.marketer_payout_requests
     set status=p_action,
         admin_note=nullif(btrim(coalesce(p_admin_note,'')),''),
         processed_at=now(),
         processed_by=p_admin_id
   where id=v_request.id;

  return jsonb_build_object('ok',true,'id',v_request.id,'status',p_action,'amount',v_request.amount);
end;
$function$;

revoke all on function public.admin_process_marketer_payout(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_process_marketer_payout(uuid,text,text,uuid) to service_role;