-- Customer-facing order sequence. The global order_number remains untouched for administration.
begin;

alter table public.orders
  add column if not exists customer_order_number integer;

-- Backfill each customer's active orders in chronological order; cancelled orders do not count.
with ranked as (
  select id, row_number() over (
    partition by user_id order by created_at, id
  )::integer as customer_number
  from public.orders
  where status <> 'cancelled'
)
update public.orders o
set customer_order_number = ranked.customer_number
from ranked
where ranked.id = o.id;

update public.orders
set customer_order_number = null
where status = 'cancelled';

create or replace function public.assign_customer_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if new.user_id is null then
    new.customer_order_number := null;
    return new;
  end if;

  -- Serialize all order creation for this customer, including concurrent requests.
  perform 1 from public.users where id = new.user_id for update;

  select coalesce(max(customer_order_number), 0) + 1
    into next_number
  from public.orders
  where user_id = new.user_id
    and status <> 'cancelled';

  new.customer_order_number := next_number;
  return new;
end;
$$;

drop trigger if exists orders_assign_customer_order_number on public.orders;
create trigger orders_assign_customer_order_number
before insert on public.orders
for each row execute function public.assign_customer_order_number();

-- Acquire the customer lock before the order row is changed, preventing
-- lock-order inversions with concurrent checkouts and cancellations.
create or replace function public.lock_customer_order_sequence()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  if old.status is distinct from new.status and new.user_id is not null then
    perform 1 from public.users where id = new.user_id for update;
  end if;
  return new;
end;
$;

drop trigger if exists orders_lock_customer_sequence on public.orders;
create trigger orders_lock_customer_sequence
before update of status on public.orders
for each row execute function public.lock_customer_order_sequence();

create or replace function public.resequence_customer_orders_after_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    -- Same per-customer lock used during creation; avoid racing a new checkout.
    perform 1 from public.users where id = new.user_id for update;

    with ranked as (
      select id, row_number() over (
        order by created_at, id
      )::integer as customer_number
      from public.orders
      where user_id = new.user_id
        and status <> 'cancelled'
    )
    update public.orders o
       set customer_order_number = ranked.customer_number
      from ranked
     where o.id = ranked.id
       and o.customer_order_number is distinct from ranked.customer_number;

    update public.orders
       set customer_order_number = null
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_resequence_customer_orders_after_cancel on public.orders;
create trigger orders_resequence_customer_orders_after_cancel
after update of status on public.orders
for each row execute function public.resequence_customer_orders_after_cancel();

revoke all on function public.assign_customer_order_number() from public, anon, authenticated;
revoke all on function public.lock_customer_order_sequence() from public, anon, authenticated;
revoke all on function public.resequence_customer_orders_after_cancel() from public, anon, authenticated;

commit;
