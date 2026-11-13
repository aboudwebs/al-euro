-- F-04 Session revocation (users.token_version) and F-08 admin two-step verification (TOTP + recovery codes).
-- Idempotent; run manually. Existing sessions stay valid: every token without a version counts as version 0.

alter table public.users add column if not exists token_version integer not null default 0 check (token_version >= 0);

-- Admin two-step verification. totp_secret_enc is AES-256-GCM sealed by the server (never stored in clear text).
-- Enforcement starts per administrator only after that admin completes enrolment from /admin/security.
alter table public.users add column if not exists totp_secret_enc text;
alter table public.users add column if not exists totp_enabled_at timestamptz;
alter table public.users add column if not exists totp_last_step bigint not null default 0;

create table if not exists public.admin_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_recovery_codes_user_idx on public.admin_recovery_codes (user_id) where used_at is null;

alter table public.admin_recovery_codes enable row level security;
revoke all on public.admin_recovery_codes from public, anon, authenticated;
