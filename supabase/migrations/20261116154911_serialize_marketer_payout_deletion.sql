-- Serialize marketer payout creation with the final account-deletion checks.
-- Payout requests remain allowed during the 30-day grace period so a marketer can settle available commissions.
BEGIN;
CREATE OR REPLACE FUNCTION public.lock_marketer_payout_during_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE account_active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.marketer_id::text, 0));
  SELECT u.is_active INTO account_active FROM public.users u WHERE u.id=NEW.marketer_id;
  IF account_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'الحساب غير نشط ولا يمكن إنشاء طلب سحب';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.lock_marketer_payout_during_deletion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_marketer_payout_during_deletion() TO service_role;
DROP TRIGGER IF EXISTS marketer_payout_requests_lock_during_deletion ON public.marketer_payout_requests;
CREATE TRIGGER marketer_payout_requests_lock_during_deletion
BEFORE INSERT ON public.marketer_payout_requests
FOR EACH ROW EXECUTE FUNCTION public.lock_marketer_payout_during_deletion();
COMMIT;
