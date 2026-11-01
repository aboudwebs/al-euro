-- Allow all notification event types emitted by the server-side FCM dispatcher.
-- The previous narrow constraint rejected these inserts, so notifyUser returned before
-- reaching Firebase Cloud Messaging; only database-triggered in-app notifications remained.
begin;

alter table public.user_notifications
  drop constraint if exists user_notifications_type_check;

alter table public.user_notifications
  add constraint user_notifications_type_check
  check (type = any (array[
    'order',
    'cashback',
    'loyalty',
    'payment',
    'system',
    'debt',
    'order_update',
    'order_ready',
    'order_delivered',
    'debt_entry',
    'discount_upgrade',
    'loyalty_reward',
    'commission_new',
    'referral_new',
    'security_new_device',
    'security_password_changed',
    'special_request_update',
    'debt_due_soon'
  ]::text[]));

commit;
