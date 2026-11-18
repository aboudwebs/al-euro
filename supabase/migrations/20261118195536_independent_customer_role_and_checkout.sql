-- Independent customer accounts: database-level role and checkout restrictions.
-- Preserve both deployed RPC overloads and add the same role/payment guards to each.
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
      and coalesce(debt_limit, 0) = 0
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
  v_signature regprocedure;
  v_definition text;
  v_old_role text := 'if p_user_role not in (''workshop'',''marketer'') then';
  v_new_role text := 'if p_user_role not in (''workshop'',''marketer'',''customer'') then';
  v_pay_guard text := E'  if p_user_role = ''customer'' and (p_pay_method not in (''sham'',''cod'') or v_used <> 0) then\n    raise exception ''حساب الزبون المستقل يقبل شام كاش أو التسليم باليد فقط، دون كاش باك أو دين'';\n  end if;\n';
  v_pay_anchor text := '  if p_pay_method not in (''sham'',''cod'',''debt'',''cashback'') then';
begin
  foreach v_signature in array array[
    'public.create_workshop_order(uuid,text,text,text,jsonb,numeric,text,text,jsonb,numeric,uuid,text)'::regprocedure,
    'public.create_workshop_order(uuid,text,text,text,jsonb,numeric,text,text,jsonb,numeric,uuid,text,text,numeric,numeric,numeric,numeric)'::regprocedure
  ]
  loop
    v_definition := pg_get_functiondef(v_signature);
    if position(v_old_role in v_definition) > 0 then
      v_definition := replace(v_definition, v_old_role, v_new_role);
    elsif position(v_new_role in v_definition) = 0 then
      raise exception 'Expected role guard was not found in %; migration stopped safely', v_signature;
    end if;

    if position(v_pay_guard in v_definition) = 0 then
      if position(v_pay_anchor in v_definition) = 0 then
        raise exception 'Expected payment validation was not found in %; migration stopped safely', v_signature;
      end if;
      v_definition := replace(v_definition, v_pay_anchor, v_pay_guard || v_pay_anchor);
    end if;

    execute v_definition;
  end loop;
end
$migration$;

commit;
