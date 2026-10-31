-- ===========================================================================
-- EURO CARS (اليورو) - UPDATE 2026-10  (profile, addresses, vehicles, categories, tracking, account deletion,
-- password recovery by WhatsApp code)
--
-- Run ONCE in the Supabase SQL editor, top to bottom, AFTER the earlier setup files (admin_full_setup.sql).
-- Idempotent: every statement can be run again safely. Nothing here deletes or rewrites existing business data.
--
-- Order (each part only depends on the parts above it):
--   1) parts.category                      -> catalogue sections in the app and the admin parts form
--   2) orders.tracking_number / delivery_address -> tracking number and the address chosen at checkout
--   3) app_settings                        -> USD -> SYP exchange rate (you enter it; nothing is invented)
--   4) user_addresses                      -> saved delivery addresses
--   5) user_vehicles                       -> registered vehicles (VIN)
--   6) account_deletion_requests           -> account deletion with a 30-day grace period
--   7) account_otp_codes                   -> WhatsApp codes: forgot password and phone change (hashed, limited tries)
--   8) license is read-only                -> database trigger (second line of defence behind the API whitelist)
--   9) process_account_deletions()         -> finishes the deletions whose 30 days are over
--  10) optional schedule (pg_cron) and verification queries
--
-- Every new table has Row Level Security ENABLED and NO policy: the public/anon key can read nothing from them.
-- Only the website server (service-role key) reaches them, exactly like the existing tables.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Catalogue sections: one optional text column on `parts` (no separate table)
-- ---------------------------------------------------------------------------
alter table public.parts add column if not exists category text;
create index if not exists parts_category_idx on public.parts (category);

-- ---------------------------------------------------------------------------
-- 2) Orders: tracking number (set by the admin) and a snapshot of the delivery address chosen at checkout
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists delivery_address jsonb;

-- ---------------------------------------------------------------------------
-- 3) Settings (key / value). The exchange rate is NOT inserted here: until you add it the app keeps showing USD.
--    To publish the rate (example only - put the real rate you use, in Syrian pounds for 1 US dollar):
--      insert into public.app_settings (key, value) values ('usd_to_syp', '<RATE>')
--      on conflict (key) do update set value = excluded.value, updated_at = now();
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;

-- ---------------------------------------------------------------------------
-- 4) Saved delivery addresses (many per user)
-- ---------------------------------------------------------------------------
create table if not exists public.user_addresses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  label       text not null check (char_length(label) between 1 and 60),
  governorate text check (governorate is null or char_length(governorate) <= 80),
  area        text check (area is null or char_length(area) <= 120),
  street      text check (street is null or char_length(street) <= 200),
  details     text check (details is null or char_length(details) <= 300),
  phone       text check (phone is null or char_length(phone) <= 32),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists user_addresses_user_idx on public.user_addresses (user_id, created_at desc);
alter table public.user_addresses enable row level security;

-- ---------------------------------------------------------------------------
-- 5) Registered vehicles (VIN). The VIN is stored upper-case; it is unique per user.
-- ---------------------------------------------------------------------------
create table if not exists public.user_vehicles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  name       text check (name is null or char_length(name) <= 80),
  vin        text not null check (vin ~ '^[A-Z0-9-]{5,32}$'),
  make       text check (make is null or char_length(make) <= 60),
  model      text check (model is null or char_length(model) <= 80),
  year       integer check (year is null or year between 1900 and 2100),
  notes      text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists user_vehicles_user_vin_uidx on public.user_vehicles (user_id, vin);
create index if not exists user_vehicles_user_idx on public.user_vehicles (user_id, created_at desc);
alter table public.user_vehicles enable row level security;

-- ---------------------------------------------------------------------------
-- 6) Account deletion requests: 'pending' for 30 days (the account keeps working and the user can cancel),
--    then process_account_deletions() anonymises the account. One pending request per user.
-- ---------------------------------------------------------------------------
create table if not exists public.account_deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'cancelled', 'completed')),
  requested_at timestamptz not null default now(),
  due_at       timestamptz not null default (now() + interval '30 days'),
  cancelled_at timestamptz,
  completed_at timestamptz
);
create unique index if not exists account_deletion_one_pending_uidx on public.account_deletion_requests (user_id) where status = 'pending';
create index if not exists account_deletion_due_idx on public.account_deletion_requests (due_at) where status = 'pending';
alter table public.account_deletion_requests enable row level security;

-- ---------------------------------------------------------------------------
-- 7) One-time codes sent by WhatsApp (forgot password, phone change). Only a keyed hash of the code is stored;
--    each code expires after 10 minutes, allows 5 wrong tries, and can be used once.
-- ---------------------------------------------------------------------------
create table if not exists public.account_otp_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  purpose    text not null check (purpose in ('password_reset', 'phone_change')),
  target     text,
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   integer not null default 0,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists account_otp_codes_user_idx on public.account_otp_codes (user_id, purpose, created_at desc);
alter table public.account_otp_codes enable row level security;

-- ---------------------------------------------------------------------------
-- 8) The company licence is read-only after registration.
--    The API already ignores it (only name / governorate / password / verified phone can be changed). This trigger
--    protects it from ANY other path, including a future bug. To correct a licence yourself, run in the SQL editor:
--      begin;
--      select set_config('app.allow_license_change', 'on', true);
--      update public.users set license = '<new value>' where id = '<user id>';
--      commit;
--    Inserts (registration) are not affected.
-- ---------------------------------------------------------------------------
create or replace function public.protect_user_license()
returns trigger
language plpgsql
as $$
begin
  if new.license is distinct from old.license
     and coalesce(current_setting('app.allow_license_change', true), '') <> 'on' then
    raise exception 'رقم الترخيص لا يمكن تعديله بعد التسجيل' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists users_protect_license on public.users;
create trigger users_protect_license
  before update of license on public.users
  for each row execute function public.protect_user_license();

-- ---------------------------------------------------------------------------
-- 9) Finish the deletions whose 30 days are over. Returns the ids it anonymised.
--    The account row is KEPT (orders, debt ledger and commissions refer to it for accounting) but nothing personal
--    stays: name, phone, licence, governorate and password are replaced, addresses and vehicles are deleted, and the
--    customer name / phone / address copied into its orders are replaced. An account that still owes money or has an
--    order in progress is skipped (the request stays pending until it is settled).
--    Run by the website at sign-in and, optionally, by the schedule below.
-- ---------------------------------------------------------------------------
create or replace function public.process_account_deletions()
returns uuid[]
language plpgsql
as $$
declare
  r record;
  done uuid[] := '{}';
  alias_phone text;
begin
  perform set_config('app.allow_license_change', 'on', true);

  for r in
    select d.id, d.user_id
    from public.account_deletion_requests d
    where d.status = 'pending' and d.due_at <= now()
    order by d.due_at
    for update of d skip locked
  loop
    if exists (select 1 from public.users u where u.id = r.user_id and coalesce(u.debt_balance, 0) > 0) then
      continue;
    end if;
    if exists (select 1 from public.orders o where o.user_id = r.user_id and o.status in ('pending', 'approved', 'shipped')) then
      continue;
    end if;

    alias_phone := 'deleted-' || substr(replace(r.user_id::text, '-', ''), 1, 16);

    update public.users
       set name = 'حساب محذوف',
           phone = alias_phone,
           password_hash = 'deleted:' || gen_random_uuid()::text,
           license = null,
           city = null,
           is_active = false
     where id = r.user_id;

    update public.orders
       set customer_name = 'حساب محذوف',
           customer_phone = alias_phone,
           delivery_address = null
     where user_id = r.user_id;

    delete from public.user_addresses where user_id = r.user_id;
    delete from public.user_vehicles  where user_id = r.user_id;
    delete from public.account_otp_codes where user_id = r.user_id;

    update public.account_deletion_requests
       set status = 'completed', completed_at = now()
     where id = r.id;

    done := done || r.user_id;
  end loop;

  return done;
end;
$$;

-- Only the server (service_role) may call it.
revoke all on function public.process_account_deletions() from public;
revoke all on function public.process_account_deletions() from anon, authenticated;
grant execute on function public.process_account_deletions() to service_role;

-- ---------------------------------------------------------------------------
-- 10) OPTIONAL: run the deletions every night even when nobody signs in (needs the pg_cron extension:
--     Supabase -> Database -> Extensions -> pg_cron). Remove the two leading dashes to enable.
--     Note: the profile photo file (storage bucket "avatars") is removed only by the website sign-in path; a
--     deletion finished by this schedule leaves that one file in storage (it is not linked to anything).
-- ---------------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- select cron.schedule('euro-process-account-deletions', '15 3 * * *', $$select public.process_account_deletions();$$);

-- ---------------------------------------------------------------------------
-- Verification (read-only). Every row should say true / exist.
-- ---------------------------------------------------------------------------
-- select column_name from information_schema.columns
--  where table_schema = 'public' and (
--        (table_name = 'parts'  and column_name = 'category')
--     or (table_name = 'orders' and column_name in ('tracking_number', 'delivery_address')));
-- select tablename, rowsecurity from pg_tables
--  where schemaname = 'public'
--    and tablename in ('app_settings', 'user_addresses', 'user_vehicles', 'account_deletion_requests', 'account_otp_codes');
-- select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('process_account_deletions', 'protect_user_license');
-- select tgname from pg_trigger where tgname = 'users_protect_license';
-- Catalogue photos: the bucket used by the admin upload must be PUBLIC for the app to show them
--   select id, public from storage.buckets where id = 'parts-images';   -- public must be true
