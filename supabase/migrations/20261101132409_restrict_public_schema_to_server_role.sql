-- All application access goes through EURO's server-side API using service_role.
-- Prevent direct PostgREST access to the public schema for client roles, including future objects.
REVOKE USAGE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
