-- ROLLBACK for the 2026-11-14 security migrations (F-01 … F-11). REVIEW ONLY: nothing here is executed automatically,
-- and it contains DROP statements, so it must be run by hand and only after explicit approval.
--
-- What it removes holds only data created by the new features (rate-limit counters, stored OTP hashes, recovery codes,
-- receipt fingerprints, referral tracking, deletion codes). It never touches users, orders, parts, ledgers or commissions,
-- except for the new columns/constraints/index listed below (their values are new, not business data).
-- Take a snapshot of those new tables first if their content matters (e.g. receipt_fingerprints, admin_recovery_codes).
-- Run in reverse order of the migrations. Deploy the previous server version BEFORE running it (the new server code reads these tables).

begin;

-- 100500 data integrity
drop index if exists public.marketer_commissions_order_unique;
alter table public.users  drop constraint if exists users_debt_balance_nonneg_chk;
alter table public.users  drop constraint if exists users_cashback_balance_nonneg_chk;
alter table public.users  drop constraint if exists users_debt_limit_nonneg_chk;
alter table public.parts  drop constraint if exists parts_stock_nonneg_chk;
alter table public.parts  drop constraint if exists parts_price_nonneg_chk;
alter table public.orders drop constraint if exists orders_total_nonneg_chk;
alter table public.orders drop constraint if exists orders_cashback_used_nonneg_chk;
alter table public.orders drop constraint if exists orders_amount_due_nonneg_chk;
-- debt_ledger.created_by (who recorded a payment) is NOT dropped on purpose: it would erase audit data. Drop it only if really required:
--   alter table public.debt_ledger drop column if exists created_by;
-- euro_uploads bucket limits (previously unlimited, any type):
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'euro_uploads';

-- 100400 referral tracking
drop table if exists public.referral_flags;
drop table if exists public.referral_signups;

-- 100300 receipt fingerprints
drop trigger if exists orders_lock_receipt_fingerprint on public.orders;
drop trigger if exists receipt_fingerprint_lock_guard on public.receipt_fingerprints;
drop function if exists public.lock_receipt_fingerprint_on_approval();
drop function if exists public.guard_receipt_fingerprint_lock();
drop table if exists public.receipt_fingerprint_events;
drop table if exists public.receipt_fingerprints;

-- 100200 session revocation + admin 2FA (rolling back signs nobody out, but admins lose their enrolled 2FA)
drop table if exists public.admin_recovery_codes;
alter table public.users drop column if exists totp_last_step;
alter table public.users drop column if exists totp_enabled_at;
alter table public.users drop column if exists totp_secret_enc;
alter table public.users drop column if exists token_version;

-- 100100 registration OTP
drop function if exists public.registration_otp_cleanup();
drop table if exists public.registration_otp_codes;

-- 100000 rate limits
drop function if exists public.auth_rate_cleanup();
drop function if exists public.auth_rate_reset(text);
drop function if exists public.auth_rate_hit(text, integer, integer, integer, boolean);
drop table if exists public.auth_rate_limits;

-- 20261108100000 account deletion email codes (only if the previous server never used it)
-- drop table if exists public.account_deletion_email_codes;

commit;
