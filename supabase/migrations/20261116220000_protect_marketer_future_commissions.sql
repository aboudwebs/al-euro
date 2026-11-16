-- Protect marketer commission accrual and payout against account-deletion races.
BEGIN;
CREATE OR REPLACE FUNCTION public.reject_new_operations_during_deletion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  account_active boolean;
  deletion_pending boolean;
  v_marketer_id uuid;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  -- Same per-user transaction lock is acquired by the deletion worker before its final checks.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

  SELECT u.is_active INTO account_active
  FROM public.users u WHERE u.id = NEW.user_id;

  IF account_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'الحساب غير نشط ولا يمكن إنشاء عمليات جديدة';
  END IF;

  -- Lock the referring marketer so deletion cannot race with a newly created referred order.
  IF TG_TABLE_NAME = 'orders' THEN
    SELECT m.id INTO v_marketer_id
    FROM public.users w
    JOIN public.users m ON m.my_ref_code = w.referred_by_code
    WHERE w.id = NEW.user_id AND w.role = 'workshop'
      AND m.role = 'marketer' AND m.is_active = true
    LIMIT 1;
    IF v_marketer_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(v_marketer_id::text, 0));
    END IF;
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
$function$
;
CREATE OR REPLACE FUNCTION public.process_account_deletions()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
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
    WHERE d.status='pending' AND d.due_at<=now()
    ORDER BY d.due_at
    FOR UPDATE OF d SKIP LOCKED
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));

    -- Do not delete privileged accounts or discard outstanding customer value.
    IF EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id=r.user_id
        AND (u.role NOT IN ('workshop','marketer')
          OR coalesce(u.debt_balance,0)>0
          OR coalesce(u.cashback_balance,0)>0)
    ) THEN CONTINUE; END IF;

    IF EXISTS (SELECT 1 FROM public.orders o WHERE o.user_id=r.user_id AND o.status IN ('pending','approved','shipped')) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.special_requests s WHERE s.user_id=r.user_id AND s.status IN ('new','priced','ordered')) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.marketer_payout_requests p WHERE p.marketer_id=r.user_id AND p.status='pending') THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.marketer_commissions c WHERE c.marketer_id=r.user_id AND c.status IN ('held','available','payout_requested')) THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM public.marketer_payout_allocations a
      JOIN public.marketer_commissions c ON c.id=a.commission_id
      WHERE c.marketer_id=r.user_id AND a.status='pending'
    ) THEN CONTINUE; END IF;

    -- Keep a marketer's referral code until all referred workshops' open orders settle.
    IF EXISTS (
      SELECT 1
      FROM public.users m
      JOIN public.users w ON w.referred_by_code=m.my_ref_code AND w.role='workshop'
      JOIN public.orders o ON o.user_id=w.id AND o.user_role='workshop'
      WHERE m.id=r.user_id AND m.role='marketer'
        AND o.status IN ('pending','approved','shipped')
    ) THEN CONTINUE; END IF;

    alias_phone := 'deleted-'||substr(replace(r.user_id::text,'-',''),1,16);

    INSERT INTO public.account_deletion_firebase_cleanup_queue(provider_uid)
    SELECT DISTINCT i.provider_uid
    FROM public.user_auth_identities i
    WHERE i.user_id=r.user_id AND i.provider='google.com'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_auth_identities other
        WHERE other.provider='google.com' AND other.provider_uid=i.provider_uid AND other.user_id<>r.user_id
      )
    ON CONFLICT(provider_uid) DO NOTHING;

    INSERT INTO public.account_deletion_storage_cleanup_queue(bucket_id,object_path)
    SELECT 'special-requests',s.image_url
    FROM public.special_requests s
    WHERE s.user_id=r.user_id AND s.image_url IS NOT NULL
    ON CONFLICT(bucket_id,object_path) DO NOTHING;

    UPDATE public.special_requests
    SET user_id=NULL, customer_name='حساب محذوف', customer_phone=alias_phone,
        other_brand=NULL, vin_or_oem=NULL, notes=NULL, image_url=NULL
    WHERE user_id=r.user_id AND status IN ('completed','cancelled');

    UPDATE public.orders
    SET user_id=NULL, customer_name='حساب محذوف', customer_phone=alias_phone,
        delivery_address=NULL, admin_note=NULL, status_note=NULL
    WHERE user_id=r.user_id;

    UPDATE public.users
    SET name='حساب محذوف',
        phone=alias_phone,
        password_hash='deleted:'||gen_random_uuid()::text,
        license=NULL,
        city=NULL,
        specs=ARRAY[]::text[],
        tier='Standard',
        debt_limit=0,
        debt_balance=0,
        cashback_balance=0,
        my_ref_code=NULL,
        referred_by_code=NULL,
        loyalty_season_started_at=NULL,
        loyalty_season_spend=0,
        is_active=false,
        license_verification_status=NULL,
        license_verification_workshop_name=NULL,
        license_verification_address=NULL,
        license_verification_evidence=NULL,
        license_verification_notes=NULL,
        phone_verified_at=NULL,
        phone_verification_required=false,
        totp_secret_enc=NULL,
        totp_enabled_at=NULL,
        totp_last_step=0,
        token_version=token_version+1
    WHERE id=r.user_id;

    DELETE FROM public.user_addresses WHERE user_id=r.user_id;
    DELETE FROM public.user_vehicles WHERE user_id=r.user_id;
    DELETE FROM public.account_otp_codes WHERE user_id=r.user_id;
    DELETE FROM public.account_deletion_email_codes WHERE user_id=r.user_id;
    DELETE FROM public.user_notifications WHERE user_id=r.user_id;
    DELETE FROM public.push_tokens WHERE user_id=r.user_id;
    DELETE FROM public.user_auth_identities WHERE user_id=r.user_id;

    UPDATE public.account_deletion_requests
    SET status='completed',completed_at=now()
    WHERE id=r.id;

    done:=done||r.user_id;
  END LOOP;
  RETURN done;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_set_order_status(p_order_id uuid, p_new_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.orders%rowtype;
  u public.users%rowtype;
  m public.users%rowtype;
  p public.parts%rowtype;
  r record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_total numeric(12,2);
  v_due numeric(12,2);
  v_bal numeric(12,2);
  v_comm numeric(12,2);
  v_season_start timestamptz;
  v_spend_before numeric(12,2);
  v_spend_after numeric(12,2);
  v_rate numeric(5,4);
  v_tier text;
  v_cashback numeric(12,2);
  v_cashback_status text;
  v_reversed_debt_cashback numeric(12,2) := 0;
  v_marketer_id uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;

  if p_new_status not in ('pending','approved','shipped','delivered','cancelled') then
    raise exception 'حالة الطلب غير صالحة';
  end if;

  if not (
       (o.status = 'pending' and p_new_status in ('approved','cancelled'))
    or (o.status = 'approved' and p_new_status in ('shipped','cancelled'))
    or (o.status = 'shipped' and p_new_status in ('delivered','cancelled'))
  ) then
    raise exception 'لا يمكن تغيير حالة الطلب من «%» إلى «%»', o.status, p_new_status;
  end if;

  v_total := round(coalesce(o.total_amount, 0), 2);
  v_due := greatest(0, round(coalesce(o.amount_due, v_total - coalesce(o.cashback_used, 0)), 2));

  -- pending -> approved: reserve stock and, for debt orders, charge the workshop.
  if p_new_status = 'approved' then
    for r in
      select e->>'part_id' as part_id, sum((e->>'qty')::int) as qty
      from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) e
      group by 1 order by 1
    loop
      select * into p from public.parts where id = r.part_id for update;
      if not found then raise exception 'القطعة رقم % لم تعد موجودة في المخزون', r.part_id; end if;
      if coalesce(p.stock, 0) < r.qty then
        raise exception 'المخزون غير كافٍ للقطعة «%» (المتوفر %، المطلوب %)', p.name, coalesce(p.stock, 0), r.qty;
      end if;
      update public.parts set stock = stock - r.qty where id = r.part_id;
    end loop;

    if o.pay_method = 'debt' then
      select * into u from public.users where id = o.user_id for update;
      if not found or u.role <> 'workshop' then raise exception 'حساب الورشة غير موجود'; end if;
      if coalesce(u.debt_limit, 0) <= 0 then raise exception 'لم يُحدَّد سقف دين لهذه الورشة'; end if;
      if coalesce(u.debt_balance, 0) + v_due > u.debt_limit then
        raise exception 'قيمة الطلب تتجاوز سقف الدين المتاح للورشة (المتاح %)',
          greatest(0, u.debt_limit - coalesce(u.debt_balance, 0));
      end if;
      v_bal := round(coalesce(u.debt_balance, 0) + v_due, 2);
      update public.users set debt_balance = v_bal where id = u.id;
      insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note)
      values (u.id, o.id, 'debit', v_due, v_bal, 'طلب رقم ' || coalesce(o.order_number::text, o.id::text));
    end if;
  end if;

  -- delivered: calculate the workshop's tier and cashback from the active 90-day season.
  if p_new_status = 'delivered' and o.user_role = 'workshop' and v_total > 0 then
    select * into u from public.users where id = o.user_id and role = 'workshop' for update;
    if found then
      if u.loyalty_season_started_at is null
         or now() >= u.loyalty_season_started_at + interval '90 days' then
        v_season_start := now();
        v_spend_before := 0;
      else
        v_season_start := u.loyalty_season_started_at;
        v_spend_before := coalesce(u.loyalty_season_spend, 0);
      end if;

      v_spend_after := round(v_spend_before + v_total, 2);

      -- Cashback rate is based on the tier BEFORE this order.
      -- The tier reached after counting this order becomes active on the NEXT order.
      v_rate := case
        when v_spend_before >= 50000 then 0.15
        when v_spend_before >= 30000 then 0.10
        when v_spend_before >= 20000 then 0.07
        when v_spend_before >= 15000 then 0.05
        when v_spend_before >= 10000 then 0.02
        else 0.00
      end;
      v_tier := case
        when v_spend_after >= 50000 then 'Elite'
        when v_spend_after >= 30000 then 'Platinum'
        when v_spend_after >= 20000 then 'Gold'
        when v_spend_after >= 15000 then 'Silver'
        when v_spend_after >= 10000 then 'Bronze'
        else 'Standard'
      end;
      v_cashback := round(greatest(0, v_total - coalesce(o.cashback_used, 0)) * v_rate, 2);
      v_cashback_status := case
        when o.pay_method = 'debt' and coalesce(u.debt_balance, 0) > 0 then 'held'
        else 'available'
      end;

      update public.users
         set loyalty_season_started_at = v_season_start,
             loyalty_season_spend = v_spend_after,
             tier = v_tier,
             cashback_balance = coalesce(cashback_balance, 0)
               + case when v_cashback_status = 'available' then v_cashback else 0 end
       where id = u.id;

      insert into public.cashback_ledger
        (workshop_id, order_id, season_started_at, purchase_amount, cashback_rate, cashback_amount, status)
      values
        (u.id, o.id, v_season_start, v_total, v_rate, v_cashback, v_cashback_status);

      -- Marketer commission: serialize the referral award with account deletion.
      if nullif(btrim(coalesce(u.referred_by_code, '')), '') is not null then
        select id into v_marketer_id from public.users
         where my_ref_code = u.referred_by_code and role = 'marketer' and is_active = true
         limit 1;
        if v_marketer_id is not null then
          perform pg_advisory_xact_lock(hashtextextended(v_marketer_id::text, 0));
          select * into m from public.users
           where id = v_marketer_id and my_ref_code = u.referred_by_code
             and role = 'marketer' and is_active = true;
          if found and not exists (
            select 1 from public.marketer_commissions where order_id = o.id
          ) then
            v_comm := round(v_total * 0.02, 2);
            if v_comm > 0 then
              insert into public.marketer_commissions
                (marketer_id, workshop_id, order_id, order_amount, commission_amount, status)
              values
                (m.id, u.id, o.id, v_total, v_comm,
                 case when o.pay_method = 'debt' and coalesce(u.debt_balance, 0) > 0 then 'held' else 'available' end);
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  -- cancelled after approval: restore stock and reverse the debt charge.
  if p_new_status = 'cancelled' and o.status in ('approved','shipped') then
    for r in
      select e->>'part_id' as part_id, sum((e->>'qty')::int) as qty
      from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) e
      group by 1 order by 1
    loop
      update public.parts set stock = stock + r.qty where id = r.part_id;
    end loop;

    if o.pay_method = 'debt' then
      select * into u from public.users where id = o.user_id for update;
      if found then
        v_bal := greatest(0, coalesce(u.debt_balance, 0) - v_due);
        update public.users set debt_balance = v_bal where id = u.id;
        insert into public.debt_ledger (workshop_id, order_id, tx_type, amount, balance_after, note)
        values (u.id, o.id, 'payment', v_due, v_bal,
                'إلغاء الطلب رقم ' || coalesce(o.order_number::text, o.id::text));

        -- A cancellation can clear the final outstanding debt just like a repayment.
        if v_bal = 0 then
          update public.marketer_commissions
             set status = 'available'
           where workshop_id = u.id and status = 'held';

          with released as (
            update public.cashback_ledger
               set status = 'available', released_at = now()
             where workshop_id = u.id and status = 'held'
             returning cashback_amount
          )
          select coalesce(sum(cashback_amount), 0)::numeric(12,2)
            into v_reversed_debt_cashback
            from released;

          if v_reversed_debt_cashback > 0 then
            update public.users
               set cashback_balance = coalesce(cashback_balance, 0) + v_reversed_debt_cashback
             where id = u.id;
          end if;
        end if;
      end if;
    end if;
  end if;

  -- Refund any cashback used on this order if it is cancelled, including while still pending.
  if p_new_status = 'cancelled' and coalesce(o.cashback_used, 0) > 0 then
    select * into u from public.users where id = o.user_id for update;
    if found and not exists (
      select 1 from public.cashback_refunds where order_id = o.id
    ) then
      update public.users
         set cashback_balance = coalesce(cashback_balance, 0) + o.cashback_used
       where id = u.id;
      insert into public.cashback_refunds(workshop_id, order_id, amount, balance_after)
      values (u.id, o.id, o.cashback_used,
              (select cashback_balance from public.users where id = u.id));
    end if;
  end if;

  update public.orders
     set status = p_new_status,
         status_note = case when p_new_status = 'cancelled' then v_note else status_note end
   where id = o.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', o.id,
    'order_number', o.order_number,
    'status', p_new_status
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.request_marketer_payout(p_marketer_id uuid, p_amount numeric, p_payout_details text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user public.users%rowtype;
  v_commission public.marketer_commissions%rowtype;
  v_request public.marketer_payout_requests%rowtype;
  v_remaining numeric(12,2);
  v_reserved numeric(12,2);
  v_take numeric(12,2);
  v_left numeric(12,2);
  v_ids uuid[] := array[]::uuid[];
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_marketer_id::text, 0));
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'مبلغ السحب غير صالح';
  end if;
  if char_length(coalesce(p_payout_details,'')) > 1000 then
    raise exception 'معلومات السحب طويلة جداً';
  end if;
  select * into v_user from public.users
   where id = p_marketer_id and role = 'marketer' and is_active = true for update;
  if not found then raise exception 'حساب المسوّق غير موجود أو غير مفعّل'; end if;
  if exists (select 1 from public.marketer_payout_requests
              where marketer_id = p_marketer_id and status = 'pending') then
    raise exception 'لديك طلب سحب قيد المراجعة بالفعل';
  end if;

  v_left := p_amount;
  for v_commission in
    select * from public.marketer_commissions
     where marketer_id = p_marketer_id and status in ('available','payout_requested')
     order by created_at, id for update
  loop
    select coalesce(sum(a.amount),0) into v_reserved
      from public.marketer_payout_allocations a
     where a.commission_id = v_commission.id and a.status in ('pending','paid');
    if v_commission.status = 'payout_requested'
       and not exists (select 1 from public.marketer_payout_allocations a where a.commission_id = v_commission.id) then
      continue;
    end if;
    v_remaining := round(v_commission.commission_amount - v_reserved, 2);
    if v_remaining <= 0 then continue; end if;
    v_take := least(v_remaining, v_left);
    if v_take > 0 then
      v_ids := array_append(v_ids, v_commission.id);
      v_left := round(v_left - v_take, 2);
      exit when v_left <= 0;
    end if;
  end loop;
  if v_left > 0 then raise exception 'رصيد العمولات المتاح أقل من المبلغ المطلوب'; end if;

  insert into public.marketer_payout_requests(marketer_id, amount, commission_ids, payout_details)
  values (p_marketer_id, p_amount, v_ids, nullif(btrim(coalesce(p_payout_details,'')), ''))
  returning * into v_request;

  v_left := p_amount;
  foreach v_commission.id in array v_ids loop
    select * into v_commission from public.marketer_commissions where id = v_commission.id;
    select coalesce(sum(a.amount),0) into v_reserved
      from public.marketer_payout_allocations a
     where a.commission_id = v_commission.id and a.status in ('pending','paid');
    v_remaining := round(v_commission.commission_amount - v_reserved, 2);
    v_take := least(v_remaining, v_left);
    insert into public.marketer_payout_allocations(request_id, commission_id, amount)
    values (v_request.id, v_commission.id, v_take);
    update public.marketer_commissions set status = 'payout_requested' where id = v_commission.id;
    v_left := round(v_left - v_take, 2);
    v_count := v_count + 1;
    exit when v_left <= 0;
  end loop;
  if v_left <> 0 or v_count <> cardinality(v_ids) then raise exception 'تعذر تخصيص مبلغ السحب للعمولات'; end if;
  return jsonb_build_object('ok',true,'id',v_request.id,'amount',v_request.amount,'status',v_request.status);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.marketer_has_open_referred_orders(p_marketer_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users m
    JOIN public.users w ON w.referred_by_code=m.my_ref_code AND w.role='workshop'
    JOIN public.orders o ON o.user_id=w.id AND o.user_role='workshop'
    WHERE m.id=p_marketer_id AND m.role='marketer'
      AND o.status IN ('pending','approved','shipped')
  );
$function$;
REVOKE ALL ON FUNCTION public.marketer_has_open_referred_orders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketer_has_open_referred_orders(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lock_marketer_commission_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $function$
DECLARE account_active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.marketer_id::text, 0));
  SELECT u.is_active INTO account_active FROM public.users u
  WHERE u.id=NEW.marketer_id AND u.role='marketer';
  IF account_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'لا يمكن إضافة عمولة إلى حساب مسوّق غير نشط';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.lock_marketer_commission_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_marketer_commission_insert() TO service_role;
DROP TRIGGER IF EXISTS marketer_commissions_lock_insert ON public.marketer_commissions;
CREATE TRIGGER marketer_commissions_lock_insert
BEFORE INSERT ON public.marketer_commissions
FOR EACH ROW EXECUTE FUNCTION public.lock_marketer_commission_insert();

COMMIT;
