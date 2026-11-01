-- Queue avatar objects for deletion when the 30-day account anonymisation completes.
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.account_deletion_cleanup_queue (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL
);
ALTER TABLE public.account_deletion_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.account_deletion_cleanup_queue FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON public.account_deletion_cleanup_queue TO service_role;
CREATE INDEX IF NOT EXISTS account_deletion_cleanup_pending_idx
  ON public.account_deletion_cleanup_queue (created_at)
  WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.queue_account_avatar_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'completed' THEN
    INSERT INTO public.account_deletion_cleanup_queue (user_id)
    VALUES (OLD.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_account_avatar_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_account_avatar_cleanup() TO service_role;

DROP TRIGGER IF EXISTS queue_account_avatar_cleanup_trigger ON public.account_deletion_requests;
CREATE TRIGGER queue_account_avatar_cleanup_trigger
AFTER UPDATE OF status ON public.account_deletion_requests
FOR EACH ROW
EXECUTE FUNCTION public.queue_account_avatar_cleanup();

-- Only the trusted server role can validate the bearer token stored in Vault.
CREATE OR REPLACE FUNCTION public.is_euro_deletion_cron_token(p_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, vault
AS $$
  SELECT COALESCE(p_token <> '', false)
    AND EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'euro_deletion_cron_token' AND decrypted_secret = p_token
    );
$$;
REVOKE ALL ON FUNCTION public.is_euro_deletion_cron_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_euro_deletion_cron_token(text) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'euro_deletion_cron_token') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'euro_deletion_cron_token',
      'Private bearer token for EURO account deletion cron endpoint',
      NULL
    );
  END IF;
END
$$;

-- Replace the database-only job with an authenticated HTTP call so the server also removes private avatar files.
DO $$
DECLARE existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job
  WHERE jobname = 'euro-process-account-deletions' LIMIT 1;
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;

  PERFORM cron.schedule(
    'euro-process-account-deletions',
    '*/15 * * * *',
    $job$
      SELECT net.http_post(
        url := 'https://al-euro-cdzo.onrender.com/api/cron/account-deletions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'euro_deletion_cron_token'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000
      );
    $job$
  );
END
$$;
