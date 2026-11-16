-- Schedule daily debt-due reminders through Supabase pg_cron.
-- Render's CRON_SECRET is mirrored in Supabase Vault; no credential is stored in source control.
DO $$
DECLARE existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job
  WHERE jobname='euro-debt-reminders' LIMIT 1;

  IF existing_job IS NOT NULL THEN
    PERFORM cron.alter_job(
      existing_job,
      schedule := '0 6 * * *',
      command := $job$
        SELECT net.http_get(
          url := 'https://control-panel-euro-cars.onrender.com/api/cron/debt-reminders',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (
              SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name='euro_debt_reminder_cron_secret'
            )
          ),
          timeout_milliseconds := 60000
        );
      $job$
    );
  ELSE
    PERFORM cron.schedule(
      'euro-debt-reminders',
      '0 6 * * *',
      $job$
        SELECT net.http_get(
          url := 'https://control-panel-euro-cars.onrender.com/api/cron/debt-reminders',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (
              SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name='euro_debt_reminder_cron_secret'
            )
          ),
          timeout_milliseconds := 60000
        );
      $job$
    );
  END IF;
END
$$;
