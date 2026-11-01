-- EURO CARS: employee order ownership and inventory audit
-- Applied as Supabase migration 20261101020717_employee_order_claims_and_inventory_audit.
-- All staff actor IDs are sourced from the server-validated session, never the browser body.

alter table public.orders
  add column if not exists claimed_by uuid references public.users(id) on delete set null,
  add column if not exists claimed_at timestamptz;
create index if not exists orders_claimed_by_created_idx on public.orders (claimed_by, created_at desc);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  part_id text not null references public.parts(id) on delete restrict,
  actor_id uuid not null references public.users(id) on delete restrict,
  movement_type text not null check (movement_type in ('initial_stock','restock','adjustment')),
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  quantity_delta integer not null check (quantity_delta <> 0),
  created_at timestamptz not null default now(),
  note text
);
create index if not exists inventory_movements_actor_created_idx on public.inventory_movements(actor_id, created_at desc);
create index if not exists inventory_movements_part_created_idx on public.inventory_movements(part_id, created_at desc);
alter table public.inventory_movements enable row level security;
revoke all on public.inventory_movements from anon, authenticated;
grant all on public.inventory_movements to service_role;

create or replace function public.claim_order_for_worker(p_order_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_worker public.users%rowtype;
begin
 select * into v_worker from public.users where id=p_actor_id and role='worker' and is_active=true;
 if not found then raise exception 'حساب الموظف غير صالح أو موقوف'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found then raise exception 'الطلب غير موجود'; end if;
 if v_order.status<>'pending' then raise exception 'لم يعد الطلب متاحاً للاستلام'; end if;
 if v_order.claimed_by is not null then
  if v_order.claimed_by=p_actor_id then return jsonb_build_object('ok',true,'already_claimed',true,'claimed_by',p_actor_id); end if;
  raise exception 'تم استلام الطلب مسبقاً من موظف آخر';
 end if;
 update public.orders set claimed_by=p_actor_id,claimed_at=now() where id=p_order_id and claimed_by is null;
 return jsonb_build_object('ok',true,'claimed_by',p_actor_id);
end; $$;

create or replace function public.admin_set_order_status_for_staff(p_order_id uuid,p_new_status text,p_note text,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor public.users%rowtype; v_order public.orders%rowtype;
begin
 select * into v_actor from public.users where id=p_actor_id and is_active=true and role in ('admin','worker');
 if not found then raise exception 'الحساب غير صالح أو موقوف'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found then raise exception 'الطلب غير موجود'; end if;
 if v_actor.role='worker' then
  if v_order.claimed_by is distinct from p_actor_id then raise exception 'لا يمكنك تعديل طلب استلمه موظف آخر؛ يجب أن تستلمه أولاً'; end if;
  if p_new_status='cancelled' then raise exception 'لا تملك صلاحية إلغاء الطلبات'; end if;
 end if;
 return public.admin_set_order_status(p_order_id,p_new_status,p_note);
end; $$;

revoke all on function public.claim_order_for_worker(uuid,uuid) from public,anon,authenticated;
revoke all on function public.admin_set_order_status_for_staff(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_order_for_worker(uuid,uuid) to service_role;
grant execute on function public.admin_set_order_status_for_staff(uuid,text,text,uuid) to service_role;

create or replace function public.admin_create_part_with_audit(p_part jsonb,p_actor_id uuid)
returns public.parts language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_part public.parts%rowtype; v_stock integer;
begin
 select * into v_actor from public.users where id=p_actor_id and role in ('admin','worker') and is_active=true;
 if not found then raise exception 'الحساب غير صالح أو موقوف'; end if;
 v_stock:=coalesce((p_part->>'stock')::integer,0);
 insert into public.parts(id,name,brand,model,years,oem_number,alt_grade,price,stock,branch,image_url,is_active,category)
 values(p_part->>'id',p_part->>'name',p_part->>'brand',coalesce(p_part->>'model',''),coalesce(p_part->>'years',''),
 p_part->>'oem_number',p_part->>'alt_grade',(p_part->>'price')::numeric,v_stock,coalesce(p_part->>'branch',''),
 p_part->>'image_url',coalesce((p_part->>'is_active')::boolean,true),p_part->>'category') returning * into v_part;
 if v_stock>0 then
  insert into public.inventory_movements(part_id,actor_id,movement_type,quantity_before,quantity_after,quantity_delta,note)
  values(v_part.id,p_actor_id,'initial_stock',0,v_stock,v_stock,'الكمية الأولية عند إنشاء القطعة');
 end if;
 return v_part;
end; $$;

create or replace function public.admin_update_part_with_audit(p_part_id text,p_patch jsonb,p_actor_id uuid)
returns public.parts language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype; v_part public.parts%rowtype; v_before integer; v_after integer;
begin
 select * into v_actor from public.users where id=p_actor_id and role in ('admin','worker') and is_active=true;
 if not found then raise exception 'الحساب غير صالح أو موقوف'; end if;
 select * into v_part from public.parts where id=p_part_id for update;
 if not found then raise exception 'القطعة غير موجودة'; end if;
 v_before:=v_part.stock; v_after:=case when p_patch?'stock' then (p_patch->>'stock')::integer else v_part.stock end;
 if v_after<0 then raise exception 'الكمية لا يمكن أن تكون سالبة'; end if;
 update public.parts set
  name=case when p_patch?'name' then p_patch->>'name' else name end,
  brand=case when p_patch?'brand' then p_patch->>'brand' else brand end,
  model=case when p_patch?'model' then p_patch->>'model' else model end,
  years=case when p_patch?'years' then p_patch->>'years' else years end,
  oem_number=case when p_patch?'oem_number' then p_patch->>'oem_number' else oem_number end,
  alt_grade=case when p_patch?'alt_grade' then p_patch->>'alt_grade' else alt_grade end,
  price=case when p_patch?'price' then (p_patch->>'price')::numeric else price end,
  stock=v_after,
  branch=case when p_patch?'branch' then p_patch->>'branch' else branch end,
  image_url=case when p_patch?'image_url' then p_patch->>'image_url' else image_url end,
  is_active=case when p_patch?'is_active' then (p_patch->>'is_active')::boolean else is_active end,
  category=case when p_patch?'category' then p_patch->>'category' else category end
 where id=p_part_id returning * into v_part;
 if v_after<>v_before then
  insert into public.inventory_movements(part_id,actor_id,movement_type,quantity_before,quantity_after,quantity_delta,note)
  values(v_part.id,p_actor_id,case when v_after>v_before then 'restock' else 'adjustment' end,v_before,v_after,v_after-v_before,'تعديل كمية المخزون من لوحة الإدارة');
 end if;
 return v_part;
end; $$;

revoke all on function public.admin_create_part_with_audit(jsonb,uuid) from public,anon,authenticated;
revoke all on function public.admin_update_part_with_audit(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.admin_create_part_with_audit(jsonb,uuid) to service_role;
grant execute on function public.admin_update_part_with_audit(text,jsonb,uuid) to service_role;
