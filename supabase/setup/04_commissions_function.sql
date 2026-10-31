-- 4.3) Mark commissions as paid (only rows that are currently 'available').
create or replace function public.admin_mark_commissions_paid(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if p_ids is null or array_length(p_ids, 1) is null then raise exception 'لم يتم اختيار أي عمولة'; end if;
  update public.marketer_commissions set status = 'paid'
   where id = any(p_ids) and status = 'available';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'paid', v_n);
end $$;
