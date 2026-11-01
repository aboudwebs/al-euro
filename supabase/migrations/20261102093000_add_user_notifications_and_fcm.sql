-- Persistent in-app notifications and idempotency for event-driven FCM delivery.
begin;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  order_id uuid references public.orders(id) on delete set null,
  event_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.user_notifications add column if not exists event_key text;
create unique index if not exists user_notifications_event_key_uidx
  on public.user_notifications(event_key) where event_key is not null;
create index if not exists user_notifications_user_created_idx
  on public.user_notifications(user_id, created_at desc);
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon, authenticated;
grant all on public.user_notifications to service_role;

commit;
