-- Distinguish a rejected workshop registration from an account that is merely awaiting approval.
alter table public.users add column if not exists rejected_at timestamptz;
create index if not exists users_rejected_at_idx on public.users(rejected_at) where rejected_at is not null;
