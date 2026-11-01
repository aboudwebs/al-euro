-- Cover the remaining foreign keys with indexes for efficient joins and parent-row checks.
CREATE INDEX IF NOT EXISTS debt_ledger_order_id_idx
  ON public.debt_ledger (order_id);
CREATE INDEX IF NOT EXISTS user_notifications_order_id_idx
  ON public.user_notifications (order_id);
CREATE INDEX IF NOT EXISTS users_deleted_by_idx
  ON public.users (deleted_by);
