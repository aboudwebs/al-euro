-- Point the scheduled account-deletion worker at the current EURO API host.
-- The previous Render hostname is retired. Keep the existing job name and cadence.
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
    $job$
      SELECT net.http_post(
        url := 'https://control-panel-euro-cars.onrender.com/api/cron/account-deletions',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
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
