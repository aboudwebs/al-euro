-- Cover the final two foreign keys reported by Supabase Performance Advisor.
begin;
create index if not exists marketer_payout_requests_processed_by_idx
  on public.marketer_payout_requests (processed_by);
create index if not exists users_license_verification_reviewed_by_idx
  on public.users (license_verification_reviewed_by);
commit;
