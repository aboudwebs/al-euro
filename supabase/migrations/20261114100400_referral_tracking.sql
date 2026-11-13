-- F-09 Referral abuse tracking: one row per referred signup (hashed caller address only) and flags for suspicious
-- patterns. Read-only for the admin; nothing here blocks sign-up or changes how marketers are activated.
-- Idempotent; run manually.

create table if not exists public.referral_signups (
  id               uuid primary key default gen_random_uuid(),
  marketer_id      uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  referral_code    text not null,
  ip_hash          text,
  created_at       timestamptz not null default now(),
  unique (referred_user_id)
);
create index if not exists referral_signups_marketer_idx on public.referral_signups (marketer_id, created_at desc);
create index if not exists referral_signups_ip_idx on public.referral_signups (ip_hash, created_at desc);

create table if not exists public.referral_flags (
  id               uuid primary key default gen_random_uuid(),
  marketer_id      uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid references public.users(id) on delete cascade,
  reason           text not null check (reason in ('self_referral','burst','shared_address')),
  created_at       timestamptz not null default now()
);
create index if not exists referral_flags_created_idx on public.referral_flags (created_at desc);

alter table public.referral_signups enable row level security;
alter table public.referral_flags enable row level security;
revoke all on public.referral_signups from public, anon, authenticated;
revoke all on public.referral_flags from public, anon, authenticated;
