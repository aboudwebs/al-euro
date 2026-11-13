-- F-02 Stored, single-use registration / phone-link codes (replaces the stateless token that held the code signature).
-- Only a keyed hash of the code is stored. Idempotent; run manually.

create table if not exists public.registration_otp_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text        not null check (char_length(phone) between 8 and 32),
  code_hash   text        not null,
  attempts    integer     not null default 0 check (attempts >= 0 and attempts <= 5),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists registration_otp_codes_phone_idx on public.registration_otp_codes (phone, created_at desc);
create index if not exists registration_otp_codes_expiry_idx on public.registration_otp_codes (expires_at);

alter table public.registration_otp_codes enable row level security;
revoke all on public.registration_otp_codes from public, anon, authenticated;

-- Optional housekeeping (codes live 5 minutes): schedule from pg_cron or run by hand.
create or replace function public.registration_otp_cleanup()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  delete from public.registration_otp_codes where expires_at < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.registration_otp_cleanup() from public, anon, authenticated;
grant execute on function public.registration_otp_cleanup() to service_role;
