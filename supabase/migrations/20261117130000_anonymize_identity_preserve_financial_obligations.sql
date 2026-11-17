-- Anonymize deleted accounts while retaining financial ledgers and unsettled balances.
BEGIN;

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

    -- Never anonymize the administrative owner account.
    IF EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = r.user_id AND u.role = 'admin'
    ) THEN
      CONTINUE;
    END IF;

    -- Recheck that the account still exists and has not already been disabled.
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

    -- Queue provider and storage cleanup before removing references.
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
    WHERE s.user_id = r.user_id AND s.image_url IS NOT NULL
    ON CONFLICT (bucket_id, object_path) DO NOTHING;

    -- Keep order amounts, line items, payment and invoice evidence for accounting.
    -- Remove the link to the account and all direct customer identifiers.
    UPDATE public.orders
    SET user_id = NULL,
        customer_name = 'حساب محذوف',
        customer_phone = alias_phone,
        delivery_address = NULL,
        admin_note = NULL,
        status_note = NULL
    WHERE user_id = r.user_id;

    -- Preserve the commercial request itself, but remove customer-provided identifiers
    -- and uploaded personal images regardless of the request's current status.
    UPDATE public.special_requests
    SET user_id = NULL,
        customer_name = 'حساب محذوف',
        customer_phone = alias_phone,
        vin_or_oem = NULL,
        notes = NULL,
        image_url = NULL
    WHERE user_id = r.user_id;

    -- Keep the user row as a non-login financial tombstone. This preserves all
    -- restrictive foreign keys and outstanding debt/cashback/commission/payout ledgers.
    -- Financial balances are intentionally NOT zeroed or discarded.
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
