-- EURO CARS: external sign-in identity links (additive migration)
-- Safe for existing accounts: legacy rows are not modified and no current login is disabled.
-- Run in Supabase SQL Editor after the existing EURO setup scripts.

create table if not exists public.user_auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('password', 'google.com', 'apple.com', 'phone')),
  provider_uid text not null,
  email text,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint user_auth_identities_provider_uid_key unique (provider, provider_uid)
);

create index if not exists user_auth_identities_user_idx
  on public.user_auth_identities (user_id, created_at);

create index if not exists user_auth_identities_email_idx
  on public.user_auth_identities (lower(email))
  where email is not null;

alter table public.user_auth_identities enable row level security;
-- Intentionally no anon/authenticated policies. Only the server service-role key may access this table.

-- New Firebase-created EURO accounts must explicitly complete phone verification.
-- Existing users default to false and retain the current login behaviour.
alter table public.users
  add column if not exists phone_verified_at timestamptz,
  add column if not exists phone_verification_required boolean not null default false;

-- Verification sanity checks (read-only).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'users'
  and column_name in ('phone_verified_at', 'phone_verification_required')
order by column_name;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'user_auth_identities';
