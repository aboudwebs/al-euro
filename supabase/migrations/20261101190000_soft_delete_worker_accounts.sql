alter table public.users
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id) on delete set null;

create index if not exists users_active_workers_idx
  on public.users (created_at desc)
  where role='worker' and is_active=true and deleted_at is null;

comment on column public.users.deleted_at is
  'Soft deletion timestamp for employee accounts; preserves order and inventory audit history.';
