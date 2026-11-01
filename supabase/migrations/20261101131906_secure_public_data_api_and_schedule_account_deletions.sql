-- EURO uses the server-side service-role client for all application database access.
-- Keep RLS enabled and remove direct Data API privileges from public client roles.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM public, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM public, anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM public, anon, authenticated;

-- Prevent new objects created by the migration role from inheriting client grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM public, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM public, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM public, anon, authenticated;

-- Complete 30-day account deletions automatically, rather than waiting for that user to sign in.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'euro-process-account-deletions'
  LIMIT 1;

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'euro-process-account-deletions',
    '*/15 * * * *',
    'select public.process_account_deletions();'
  );
END
$$;
