-- Add the three missing indexes identified by Supabase's foreign-key performance advisor.
BEGIN;
CREATE INDEX IF NOT EXISTS debt_ledger_created_by_idx
  ON public.debt_ledger(created_by);
CREATE INDEX IF NOT EXISTS referral_flags_marketer_id_idx
  ON public.referral_flags(marketer_id);
CREATE INDEX IF NOT EXISTS referral_flags_referred_user_id_idx
  ON public.referral_flags(referred_user_id);
COMMIT;
