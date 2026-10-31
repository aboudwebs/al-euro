-- 4.4) Everything the /admin overview page needs, in one round trip.
create or replace function public.admin_overview(p_low_stock int default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'revenue_total',       coalesce((select sum(total_amount) from public.orders where status in ('approved','shipped','delivered')), 0),
    'revenue_30d',         coalesce((select sum(total_amount) from public.orders where status in ('approved','shipped','delivered') and created_at >= now() - interval '30 days'), 0),
    'pending_orders',      (select count(*) from public.orders where status = 'pending'),
    'pending_sham',        (select count(*) from public.orders where status = 'pending' and pay_method = 'sham'),
    'pending_activations', (select count(*) from public.users where is_active = false and role in ('workshop','marketer')),
    'total_debt',          coalesce((select sum(debt_balance) from public.users where role = 'workshop'), 0),
    'new_requests',        (select count(*) from public.special_requests where status = 'new'),
    'available_commissions', coalesce((select sum(commission_amount) from public.marketer_commissions where status = 'available'), 0),
    'held_commissions',    coalesce((select sum(commission_amount) from public.marketer_commissions where status = 'held'), 0),
    'low_stock_threshold', p_low_stock,
    'branches', coalesce((
      select jsonb_agg(b order by b->>'branch') from (
        select jsonb_build_object(
          'branch',      coalesce(nullif(btrim(branch), ''), 'بدون فرع'),
          'parts_count', count(*),
          'total_stock', coalesce(sum(stock), 0),
          'stock_value', coalesce(sum(stock * price), 0),
          'low_count',   count(*) filter (where stock <= p_low_stock)
        ) as b
        from public.parts where is_active
        group by coalesce(nullif(btrim(branch), ''), 'بدون فرع')
      ) x), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(l) from (
        select jsonb_build_object('id', id, 'name', name, 'brand', brand,
                                  'branch', coalesce(nullif(btrim(branch), ''), 'بدون فرع'), 'stock', stock) as l
        from public.parts where is_active and stock <= p_low_stock
        order by stock, name limit 50
      ) y), '[]'::jsonb)
  );
$$;

-- Only the server (service_role) may call these.
