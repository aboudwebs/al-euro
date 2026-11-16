-- Short-lived, single-use email verification codes for account deletion.
CREATE TABLE IF NOT EXISTS public.account_deletion_email_codes (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  resend_after timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_deletion_email_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.account_deletion_email_codes FROM public, anon, authenticated;
