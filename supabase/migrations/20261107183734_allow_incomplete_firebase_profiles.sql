-- OAuth accounts may exist before the customer provides a name and WhatsApp-verified phone.
-- Existing password accounts retain their values; checkout remains protected by phone_verification_required.
ALTER TABLE public.users ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

COMMENT ON COLUMN public.users.phone_verification_required IS
  'When true, the account may browse but server-side purchase actions are blocked until WhatsApp verification completes.';
