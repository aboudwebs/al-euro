-- F-11 Data-integrity constraints. Nothing is deleted and no function is changed.
-- Every CHECK is added NOT VALID (enforced for new and changed rows at once) and then validated against the existing
-- data inside a guarded block: if some old row violates it, a NOTICE is raised and the constraint simply stays
-- "not validated" instead of failing the migration. Idempotent; run manually.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('users',  'users_debt_balance_nonneg_chk',     'check (debt_balance is null or debt_balance >= 0)'),
      ('users',  'users_cashback_balance_nonneg_chk', 'check (cashback_balance is null or cashback_balance >= 0)'),
      ('users',  'users_debt_limit_nonneg_chk',       'check (debt_limit is null or debt_limit >= 0)'),
      ('parts',  'parts_stock_nonneg_chk',            'check (stock >= 0)'),
      ('parts',  'parts_price_nonneg_chk',            'check (price >= 0)'),
      ('orders', 'orders_total_nonneg_chk',           'check (total_amount >= 0)'),
      ('orders', 'orders_cashback_used_nonneg_chk',   'check (cashback_used is null or cashback_used >= 0)'),
      ('orders', 'orders_amount_due_nonneg_chk',      'check (amount_due is null or amount_due >= 0)')
    ) as t(tbl, cname, def)
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = r.cname and conrelid = format('public.%I', r.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I %s not valid', r.tbl, r.cname, r.def);
    end if;
    begin
      execute format('alter table public.%I validate constraint %I', r.tbl, r.cname);
    exception when others then
      raise notice 'constraint % on % left NOT VALID (existing rows violate it): %', r.cname, r.tbl, sqlerrm;
    end;
  end loop;
end $$;

-- One commission row per order (the SQL functions already guard this with NOT EXISTS; the index makes it a fact).
-- Skipped with a NOTICE when duplicates already exist, so they can be reviewed first.
do $$
begin
  if exists (
    select 1 from public.marketer_commissions
     where order_id is not null group by order_id having count(*) > 1
  ) then
    raise notice 'marketer_commissions has several rows for the same order: unique index NOT created, review them first';
  else
    create unique index if not exists marketer_commissions_order_unique
      on public.marketer_commissions (order_id) where order_id is not null;
  end if;
end $$;

-- Who recorded a debt payment (written by the server after admin_record_debt_payment).
alter table public.debt_ledger add column if not exists created_by uuid references public.users(id) on delete set null;

-- euro_uploads is a PUBLIC bucket that the application does not use and that had no limits: cap it.
-- (Skipped silently if the storage schema is not available.)
do $$
begin
  update storage.buckets
     set file_size_limit = 5242880,
         allowed_mime_types = array['image/jpeg','image/png','image/webp']
   where id = 'euro_uploads' and (file_size_limit is null or allowed_mime_types is null);
exception when others then
  raise notice 'euro_uploads limits not applied: %', sqlerrm;
end $$;
