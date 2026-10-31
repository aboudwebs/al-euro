-- Enable the dedicated staff role used only for web-admin worker accounts.
-- Run this migration in the Supabase SQL Editor before creating worker accounts.
alter table public.users drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role in ('workshop', 'marketer', 'admin', 'worker'));
