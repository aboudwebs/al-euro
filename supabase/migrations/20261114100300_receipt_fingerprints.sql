-- F-05 One receipt, one order. The server stores the SHA-256 of each uploaded Sham Cash receipt; the insert is the lock
-- (parallel requests), and a trigger locks the fingerprint for good once its order is approved.
-- Existing receipts are not back-filled (production has no Sham Cash orders yet). Idempotent; run manually.
-- This migration does NOT change create_workshop_order, admin_set_order_status or any other function.

create table if not exists public.receipt_fingerprints (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  order_id    uuid references public.orders(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  locked_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists receipt_fingerprints_order_idx on public.receipt_fingerprints (order_id);
create index if not exists receipt_fingerprints_user_idx on public.receipt_fingerprints (user_id);

create table if not exists public.receipt_fingerprint_events (
  id          bigint generated always as identity primary key,
  fingerprint text not null,
  user_id     uuid,
  order_id    uuid,
  event       text not null check (event in ('claimed','blocked_duplicate','reused_after_cancel','stale_claim_taken','locked')),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists receipt_fingerprint_events_fp_idx on public.receipt_fingerprint_events (fingerprint, created_at desc);

alter table public.receipt_fingerprints enable row level security;
alter table public.receipt_fingerprint_events enable row level security;
revoke all on public.receipt_fingerprints from public, anon, authenticated;
revoke all on public.receipt_fingerprint_events from public, anon, authenticated;

-- A locked fingerprint can never be changed or taken over (deletes stay possible so that order/account deletion cascades keep working).
create or replace function public.guard_receipt_fingerprint_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.locked_at is not null then
    raise exception 'إشعار التحويل مقفل: استُخدم في طلب تمت الموافقة عليه';
  end if;
  return new;
end;
$$;
drop trigger if exists receipt_fingerprint_lock_guard on public.receipt_fingerprints;
create trigger receipt_fingerprint_lock_guard
  before update on public.receipt_fingerprints
  for each row execute function public.guard_receipt_fingerprint_lock();

-- Approval (or any later state) of an order locks its receipt fingerprint.
create or replace function public.lock_receipt_fingerprint_on_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_fp text;
begin
  if new.status in ('approved','shipped','delivered') and old.status is distinct from new.status then
    -- the lock guard above forbids updates of a locked row, so set locked_at on rows that are still open
    update public.receipt_fingerprints
       set locked_at = now()
     where order_id = new.id and locked_at is null
    returning fingerprint into v_fp;
    if v_fp is not null then
      insert into public.receipt_fingerprint_events (fingerprint, user_id, order_id, event)
      values (v_fp, new.user_id, new.id, 'locked');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_lock_receipt_fingerprint on public.orders;
create trigger orders_lock_receipt_fingerprint
  after update of status on public.orders
  for each row execute function public.lock_receipt_fingerprint_on_approval();

revoke all on function public.guard_receipt_fingerprint_lock() from public, anon, authenticated;
revoke all on function public.lock_receipt_fingerprint_on_approval() from public, anon, authenticated;
