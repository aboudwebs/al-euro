revoke all on function public.admin_set_order_status(uuid, text, text)        from public, anon, authenticated;
revoke all on function public.admin_record_debt_payment(uuid, numeric, text)  from public, anon, authenticated;
revoke all on function public.admin_mark_commissions_paid(uuid[])             from public, anon, authenticated;
revoke all on function public.admin_overview(int)                             from public, anon, authenticated;
grant execute on function public.admin_set_order_status(uuid, text, text)       to service_role;
grant execute on function public.admin_record_debt_payment(uuid, numeric, text) to service_role;
grant execute on function public.admin_mark_commissions_paid(uuid[])            to service_role;
grant execute on function public.admin_overview(int)                            to service_role;
