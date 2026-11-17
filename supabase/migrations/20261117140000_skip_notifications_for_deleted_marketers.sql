-- Do not recreate personal notifications for accounts that completed deletion.
BEGIN;

CREATE OR REPLACE FUNCTION public.notify_marketer_payout_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active boolean;
BEGIN
  SELECT u.is_active INTO v_active
  FROM public.users u
  WHERE u.id = NEW.marketer_id;

  IF v_active IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.user_notifications(user_id,type,title,body)
    VALUES (
      NEW.marketer_id,
      'payment',
      'تم استلام طلب سحب العمولات',
      'تم استلام طلب تحويل بقيمة ' || to_char(NEW.amount,'FM999999990.00') || ' $ وهو بانتظار مراجعة الإدارة.'
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.user_notifications(user_id,type,title,body)
    VALUES (
      NEW.marketer_id,
      'payment',
      CASE NEW.status
        WHEN 'paid' THEN 'تم تسجيل تحويل عمولاتك'
        ELSE 'تم رفض طلب تحويل العمولات'
      END,
      CASE NEW.status
        WHEN 'paid' THEN 'تم تسجيل طلب التحويل كمدفوع بقيمة ' || to_char(NEW.amount,'FM999999990.00') || ' $.'
        ELSE 'أُعيدت العمولات إلى رصيدك المتاح. ' || coalesce(NEW.admin_note,'')
      END
    );
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
