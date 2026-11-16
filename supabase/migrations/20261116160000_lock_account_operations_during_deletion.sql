-- Serialize new customer obligations against scheduled account deletion.
BEGIN;

CREATE OR REPLACE FUNCTION public.reject_new_operations_during_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  account_active boolean;
  deletion_pending boolean;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  -- Same per-user transaction lock is acquired by the deletion worker before its final checks.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

  SELECT u.is_active INTO account_active
  FROM public.users u WHERE u.id = NEW.user_id;

  IF account_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'الحساب غير نشط ولا يمكن إنشاء عمليات جديدة';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.account_deletion_requests d
    WHERE d.user_id = NEW.user_id AND d.status = 'pending'
  ) INTO deletion_pending;

  IF deletion_pending THEN
    RAISE EXCEPTION 'يوجد طلب حذف حساب قيد الانتظار. ألغِ طلب الحذف أولاً قبل إنشاء عمليات جديدة';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_new_operations_during_deletion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_new_operations_during_deletion() TO service_role;

DROP TRIGGER IF EXISTS orders_reject_during_account_deletion ON public.orders;
CREATE TRIGGER orders_reject_during_account_deletion
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.reject_new_operations_during_deletion();

DROP TRIGGER IF EXISTS special_requests_reject_during_account_deletion ON public.special_requests;
CREATE TRIGGER special_requests_reject_during_account_deletion
BEFORE INSERT ON public.special_requests
FOR EACH ROW EXECUTE FUNCTION public.reject_new_operations_during_deletion();

CREATE OR REPLACE FUNCTION public.process_account_deletions()
RETURNS uuid[]
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  r record;
  done uuid[] := '{}';
  alias_phone text;
BEGIN
  PERFORM set_config('app.allow_license_change', 'on', true);

  FOR r IN
    SELECT d.id, d.user_id
    FROM public.account_deletion_requests d
    WHERE d.status = 'pending' AND d.due_at <= now()
    ORDER BY d.due_at
    FOR UPDATE OF d SKIP LOCKED
  LOOP
    -- Serialize final checks with order/special-request inserts for this user.
    PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text, 0));

    IF EXISTS (SELECT 1 FROM public.users u WHERE u.id=r.user_id AND coalesce(u.debt_balance,0)>0) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.orders o WHERE o.user_id=r.user_id AND o.status IN ('pending','approved','shipped')) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.special_requests s WHERE s.user_id=r.user_id AND s.status IN ('new','priced','ordered')) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.marketer_payout_requests p WHERE p.marketer_id=r.user_id AND p.status='pending') THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.marketer_commissions c WHERE c.marketer_id=r.user_id AND c.status IN ('held','available','payout_requested')) THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM public.marketer_payout_allocations a
      JOIN public.marketer_commissions c ON c.id=a.commission_id
      WHERE c.marketer_id=r.user_id AND a.status='pending'
    ) THEN CONTINUE; END IF;

    alias_phone := 'deleted-' || substr(replace(r.user_id::text,'-',''),1,16);
    INSERT INTO public.account_deletion_firebase_cleanup_queue(provider_uid)
    SELECT DISTINCT i.provider_uid FROM public.user_auth_identities i
    WHERE i.user_id=r.user_id AND NOT EXISTS (
      SELECT 1 FROM public.user_auth_identities other
      WHERE other.provider_uid=i.provider_uid AND other.user_id<>r.user_id
    ) ON CONFLICT(provider_uid) DO NOTHING;

    INSERT INTO public.account_deletion_storage_cleanup_queue(bucket_id,object_path)
    SELECT 'special-requests',s.image_url FROM public.special_requests s
    WHERE s.user_id=r.user_id AND s.image_url IS NOT NULL
    ON CONFLICT(bucket_id,object_path) DO NOTHING;

    UPDATE public.special_requests SET user_id=NULL,customer_name='حساب محذوف',
      customer_phone=alias_phone,image_url=NULL
    WHERE user_id=r.user_id AND status IN ('completed','cancelled');

    UPDATE public.users SET name='حساب محذوف',phone=alias_phone,
      password_hash='deleted:'||gen_random_uuid()::text,license=NULL,city=NULL,is_active=false
    WHERE id=r.user_id;
    UPDATE public.orders SET customer_name='حساب محذوف',customer_phone=alias_phone,delivery_address=NULL
    WHERE user_id=r.user_id;

    DELETE FROM public.user_addresses WHERE user_id=r.user_id;
    DELETE FROM public.user_vehicles WHERE user_id=r.user_id;
    DELETE FROM public.account_otp_codes WHERE user_id=r.user_id;
    DELETE FROM public.account_deletion_email_codes WHERE user_id=r.user_id;
    DELETE FROM public.user_notifications WHERE user_id=r.user_id;
    DELETE FROM public.push_tokens WHERE user_id=r.user_id;
    DELETE FROM public.user_auth_identities WHERE user_id=r.user_id;
    UPDATE public.account_deletion_requests SET status='completed',completed_at=now() WHERE id=r.id;
    done := done || r.user_id;
  END LOOP;
  RETURN done;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_account_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_account_deletions() TO service_role;

COMMIT;
