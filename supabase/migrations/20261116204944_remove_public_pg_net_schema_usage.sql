-- Ensure the pg_net extension is callable only by trusted server/database roles.
-- Cron runs as postgres; browser-facing roles must not be able to invoke arbitrary HTTP requests.
BEGIN;
REVOKE USAGE ON SCHEMA net FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA net TO postgres;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO postgres;
COMMIT;
