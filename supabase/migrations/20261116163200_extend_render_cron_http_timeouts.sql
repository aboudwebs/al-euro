-- Allow for Render Free cold starts when Supabase cron invokes the production API.
-- Keep the schedule unchanged; only increase the HTTP request timeout to 60 seconds.
DO $$
DECLARE
  deletion_job bigint;
  debt_job bigint;
BEGIN
  SELECT jobid INTO deletion_job FROM cron.job WHERE jobname='euro-process-account-deletions' LIMIT 1;
  IF deletion_job IS NOT NULL THEN
    PERFORM cron.alter_job(
      deletion_job,
      command := $job$
        SELECT net.http_post(
          url := 'https://control-panel-euro-cars.onrender.com/api/cron/account-deletions',
          headers := jsonb_build_object(
            'Content-Type','application/json',
            'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='euro_deletion_cron_token')
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  END IF;

  SELECT jobid INTO debt_job FROM cron.job WHERE jobname='euro-debt-reminders' LIMIT 1;
  IF debt_job IS NOT NULL THEN
    PERFORM cron.alter_job(
      debt_job,
      command := $job$
        SELECT net.http_get(
          url := 'https://control-panel-euro-cars.onrender.com/api/cron/debt-reminders',
          headers := jsonb_build_object(
            'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='euro_debt_reminder_cron_secret')
          ),
          timeout_milliseconds := 60000
        );
      $job$
    );
  END IF;
END
$$;
