-- Restrict pg_net HTTP request functions to trusted server/database roles.
-- Supabase cron jobs run as postgres; browser-facing roles never need direct net access.
BEGIN;
REVOKE ALL ON SCHEMA net FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA net TO postgres;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO postgres;

COMMIT;
