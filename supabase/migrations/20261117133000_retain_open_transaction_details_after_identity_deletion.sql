-- Retain only operational details required to complete in-flight transactions,
-- then automatically anonymize them when the transaction reaches a terminal state.
BEGIN;

CREATE OR REPLACE FUNCTION public.anonymize_closed_deleted_account_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  deleted_account boolean;
BEGIN
  IF NEW.status NOT IN ('delivered', 'cancelled', 'canceled', 'completed') THEN
    RETURN NEW;
  END IF;

  SELECT (u.is_active = false AND u.name = 'حساب محذوف')
  INTO deleted_account
  FROM public.users u
  WHERE u.id = NEW.user_id;

  IF deleted_account IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  NEW.customer_name := 'حساب محذوف';
  NEW.customer_phone := 'deleted-' || substr(replace(NEW.user_id::text, '-', ''), 1, 16);
  NEW.delivery_address := NULL;
  NEW.admin_note := NULL;
  NEW.status_note := NULL;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_anonymize_closed_deleted_account ON public.orders;
CREATE TRIGGER orders_anonymize_closed_deleted_account
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.anonymize_closed_deleted_account_order();

CREATE OR REPLACE FUNCTION public.anonymize_closed_deleted_account_special_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  deleted_account boolean;
BEGIN
  IF NEW.status NOT IN ('completed', 'cancelled', 'canceled') THEN
    RETURN NEW;
  END IF;

  SELECT (u.is_active = false AND u.name = 'حساب محذوف')
  INTO deleted_account
  FROM public.users u
  WHERE u.id = NEW.user_id;

  IF deleted_account IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  IF NEW.image_url IS NOT NULL THEN
    INSERT INTO public.account_deletion_storage_cleanup_queue(bucket_id, object_path)
    VALUES ('special-requests', NEW.image_url)
    ON CONFLICT (bucket_id, object_path) DO NOTHING;
  END IF;

  NEW.customer_name := 'حساب محذوف';
  NEW.customer_phone := 'deleted-' || substr(replace(NEW.user_id::text, '-', ''), 1, 16);
  NEW.vin_or_oem := NULL;
  NEW.notes := NULL;
  NEW.image_url := NULL;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS special_requests_anonymize_closed_deleted_account ON public.special_requests;
CREATE TRIGGER special_requests_anonymize_closed_deleted_account
BEFORE UPDATE OF status ON public.special_requests
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.anonymize_closed_deleted_account_special_request();

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
    PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text, 0));

    IF EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = r.user_id AND u.role = 'admin'
    ) THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = r.user_id AND u.is_active = true
    ) THEN
      UPDATE public.account_deletion_requests
      SET status = 'completed', completed_at = COALESCE(completed_at, now())
      WHERE id = r.id;
      CONTINUE;
    END IF;

    alias_phone := 'deleted-' || substr(replace(r.user_id::text, '-', ''), 1, 16);

    INSERT INTO public.account_deletion_firebase_cleanup_queue(provider_uid)
    SELECT DISTINCT i.provider_uid
    FROM public.user_auth_identities i
    WHERE i.user_id = r.user_id
      AND i.provider = 'google.com'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_auth_identities other
        WHERE other.provider_uid = i.provider_uid AND other.user_id <> r.user_id
      )
    ON CONFLICT (provider_uid) DO NOTHING;

    INSERT INTO public.account_deletion_cleanup_queue(user_id)
    VALUES (r.user_id)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.account_deletion_storage_cleanup_queue(bucket_id, object_path)
    SELECT 'special-requests', s.image_url
    FROM public.special_requests s
    WHERE s.user_id = r.user_id
      AND s.image_url IS NOT NULL
      AND s.status IN ('completed', 'cancelled', 'canceled')
    ON CONFLICT (bucket_id, object_path) DO NOTHING;

    -- Completed/cancelled orders are anonymized immediately. In-flight orders retain
    -- only the contact and delivery details needed to finish the existing transaction.
    UPDATE public.orders
    SET customer_name = 'حساب محذوف',
        customer_phone = alias_phone,
        delivery_address = NULL,
        admin_note = NULL,
        status_note = NULL
    WHERE user_id = r.user_id
      AND status IN ('delivered', 'cancelled', 'canceled', 'completed');

    -- Existing open special requests retain only operational details until closure.
    UPDATE public.special_requests
    SET customer_name = 'حساب محذوف',
        customer_phone = alias_phone,
        vin_or_oem = NULL,
        notes = NULL,
        image_url = NULL
    WHERE user_id = r.user_id
      AND status IN ('completed', 'cancelled', 'canceled');

    -- Keep a non-login tombstone so financial ledgers and in-flight transactions remain
    -- referentially intact. Do not zero debt, cashback or commission/payout records.
    UPDATE public.users
    SET name = 'حساب محذوف',
        phone = alias_phone,
        password_hash = 'deleted:' || gen_random_uuid()::text,
        license = NULL,
        city = NULL,
        specs = ARRAY[]::text[],
        my_ref_code = NULL,
        referred_by_code = NULL,
        loyalty_season_started_at = NULL,
        loyalty_season_spend = 0,
        deleted_at = COALESCE(deleted_at, now()),
        deleted_by = NULL,
        is_active = false,
        license_verification_status = NULL,
        license_verification_workshop_name = NULL,
        license_verification_address = NULL,
        license_verification_evidence = NULL,
        license_verification_notes = NULL,
        license_verification_reviewed_at = NULL,
        license_verification_reviewed_by = NULL,
        phone_verified_at = NULL,
        phone_verification_required = false,
        totp_secret_enc = NULL,
        totp_enabled_at = NULL,
        totp_last_step = 0,
        token_version = token_version + 1
    WHERE id = r.user_id;

    DELETE FROM public.user_addresses WHERE user_id = r.user_id;
    DELETE FROM public.user_vehicles WHERE user_id = r.user_id;
    DELETE FROM public.account_otp_codes WHERE user_id = r.user_id;
    DELETE FROM public.account_deletion_email_codes WHERE user_id = r.user_id;
    DELETE FROM public.user_notifications WHERE user_id = r.user_id;
    DELETE FROM public.push_tokens WHERE user_id = r.user_id;
    DELETE FROM public.user_auth_identities WHERE user_id = r.user_id;

    UPDATE public.account_deletion_requests
    SET status = 'completed', completed_at = now()
    WHERE id = r.id;

    done := done || r.user_id;
  END LOOP;

  RETURN done;
END;
$function$;

REVOKE ALL ON FUNCTION public.process_account_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_account_deletions() TO service_role;

COMMIT;
