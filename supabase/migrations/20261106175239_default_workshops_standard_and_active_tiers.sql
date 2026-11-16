-- Ensure every newly registered workshop starts at Standard and keep stored tiers aligned with season spend.
begin;

alter table public.users
  alter column tier set default 'Standard';

update public.users
set tier = case
  when loyalty_season_started_at is null or now() >= loyalty_season_started_at + interval '90 days' then 'Standard'
  when coalesce(loyalty_season_spend, 0) >= 50000 then 'Elite'
  when coalesce(loyalty_season_spend, 0) >= 30000 then 'Platinum'
  when coalesce(loyalty_season_spend, 0) >= 20000 then 'Gold'
  when coalesce(loyalty_season_spend, 0) >= 15000 then 'Silver'
  when coalesce(loyalty_season_spend, 0) >= 10000 then 'Bronze'
  else 'Standard'
end
where role = 'workshop';

commit;
