-- Independent customer accounts: database-level role and checkout restrictions.
-- The live function body is preserved; only its role allow-list is extended.
begin;

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('workshop', 'marketer', 'customer', 'admin', 'worker'));

alter table public.orders drop constraint if exists orders_user_role_check;
alter table public.orders
  add constraint orders_user_role_check
  check (user_role in ('workshop', 'marketer', 'customer'));

alter table public.users drop constraint if exists users_independent_customer_financials_check;
alter table public.users
  add constraint users_independent_customer_financials_check
  check (
    role <> 'customer'
    or (
      coalesce(debt_balance, 0) = 0
      and coalesce(cashback_balance, 0) = 0
    )
  );

alter table public.orders drop constraint if exists orders_independent_customer_checkout_check;
alter table public.orders
  add constraint orders_independent_customer_checkout_check
  check (
    user_role <> 'customer'
    or (
      pay_method in ('sham', 'cod')
      and coalesce(cashback_used, 0) = 0
    )
  );

do $migration$
declare
  v_signature regprocedure :=
    'public.create_workshop_order(uuid,text,text,text,jsonb,numeric,text,text,jsonb,numeric,uuid,text,text,numeric,numeric,numeric,numeric)'::regprocedure;
  v_definition text;
  v_old text := 'if p_user_role not in (''workshop'',''marketer'') then';
  v_new text := 'if p_user_role not in (''workshop'',''marketer'',''customer'') then';
begin
  v_definition := pg_get_functiondef(v_signature);
  if position(v_old in v_definition) = 0 then
    raise exception 'Expected role guard was not found in create_workshop_order; migration stopped safely';
  end if;
  if position(v_new in v_definition) > 0 then
    raise exception 'Customer role already exists in create_workshop_order; inspect migration state';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

commit;
