-- Restrict trigger-only SECURITY DEFINER functions to the trusted server role.
-- Trigger execution continues to work; these functions are not application RPC endpoints.
ALTER FUNCTION public.process_account_deletions()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.protect_user_license()
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.notify_marketer_payout_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_order_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_special_request_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_workshop_loyalty_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_sham_cash_approval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_user_license() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_account_deletions() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.notify_marketer_payout_owner() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_order_owner() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_special_request_owner() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_workshop_loyalty_changes() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_sham_cash_approval() TO service_role;
GRANT EXECUTE ON FUNCTION public.protect_user_license() TO service_role;
GRANT EXECUTE ON FUNCTION public.process_account_deletions() TO service_role;
