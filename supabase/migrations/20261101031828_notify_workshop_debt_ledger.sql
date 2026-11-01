create or replace function public.notify_workshop_debt_ledger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.user_notifications(user_id,type,title,body,order_id)
  values(
    new.workshop_id,
    'debt',
    case when new.tx_type = 'debit' then 'تم تسجيل مبلغ على دفتر الدين' else 'تم تسجيل تسديد على دفتر الدين' end,
    case when new.tx_type = 'debit'
      then 'تم تسجيل ' || to_char(new.amount,'FM999999990.00') || ' $ كدين. الرصيد المستحق الآن ' || to_char(new.balance_after,'FM999999990.00') || ' $.'
      else 'تم تسجيل تسديد ' || to_char(new.amount,'FM999999990.00') || ' $. الرصيد المتبقي ' || to_char(new.balance_after,'FM999999990.00') || ' $.'
    end,
    new.order_id
  );
  return new;
end;
$function$;

drop trigger if exists debt_ledger_notify_owner on public.debt_ledger;
create trigger debt_ledger_notify_owner
after insert on public.debt_ledger
for each row execute function public.notify_workshop_debt_ledger();

revoke all on function public.notify_workshop_debt_ledger() from public, anon, authenticated;
grant execute on function public.notify_workshop_debt_ledger() to service_role;
