-- F-01 Login / OTP / recovery brute-force protection: a shared, atomic counter store.
-- Idempotent. Not executed by the application; run it manually (see docs/MANUAL-STEPS.md).
-- Until it is applied the server falls back to per-process counters and logs a warning (it never turns the limits off).

create table if not exists public.auth_rate_limits (
  key           text primary key check (char_length(key) between 1 and 200),
  window_start  timestamptz not null default now(),
  attempts      integer     not null default 0 check (attempts >= 0),
  blocked_until timestamptz,
  updated_at    timestamptz not null default now()
);
create index if not exists auth_rate_limits_updated_idx on public.auth_rate_limits (updated_at);

alter table public.auth_rate_limits enable row level security;
revoke all on public.auth_rate_limits from public, anon, authenticated;

-- One call = one attempt (or a read-only "am I blocked?" when p_increment is false). Fixed window; once the limit is
-- exceeded the key is blocked for p_block_seconds. Row-locked, so parallel requests cannot slip past the limit.
create or replace function public.auth_rate_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer,
  p_increment boolean default true
)
returns table(allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_row    public.auth_rate_limits%rowtype;
  v_window timestamptz;
  v_count  integer;
begin
  if p_key is null or char_length(p_key) = 0 or char_length(p_key) > 200 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception 'invalid rate limit rule';
  end if;

  if p_increment then
    insert into public.auth_rate_limits (key, window_start, attempts, blocked_until, updated_at)
    values (p_key, v_now, 0, null, v_now)
    on conflict (key) do nothing;
  end if;

  select * into v_row from public.auth_rate_limits where key = p_key for update;
  if not found then
    return query select true, 0;     -- read-only check of a key that was never counted
    return;
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);
    return;
  end if;
  if not p_increment then
    return query select true, 0;
    return;
  end if;

  v_window := v_row.window_start;
  v_count  := v_row.attempts;
  if v_window + make_interval(secs => p_window_seconds) <= v_now then
    v_window := v_now;
    v_count  := 0;
  end if;
  v_count := v_count + 1;

  if v_count > p_limit then
    update public.auth_rate_limits
       set window_start = v_window, attempts = v_count,
           blocked_until = v_now + make_interval(secs => p_block_seconds), updated_at = v_now
     where key = p_key;
    return query select false, p_block_seconds;
    return;
  end if;

  update public.auth_rate_limits
     set window_start = v_window, attempts = v_count, blocked_until = null, updated_at = v_now
   where key = p_key;
  return query select true, 0;
end;
$$;

create or replace function public.auth_rate_reset(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.auth_rate_limits where key = p_key;
$$;

-- Housekeeping: removes counters that have been idle for two days. Run it from pg_cron or by hand, e.g.
--   select cron.schedule('euro-auth-rate-cleanup', '17 3 * * *', $$select public.auth_rate_cleanup()$$);
create or replace function public.auth_rate_cleanup()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  delete from public.auth_rate_limits where updated_at < now() - interval '2 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.auth_rate_hit(text, integer, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.auth_rate_reset(text) from public, anon, authenticated;
revoke all on function public.auth_rate_cleanup() from public, anon, authenticated;
grant execute on function public.auth_rate_hit(text, integer, integer, integer, boolean) to service_role;
grant execute on function public.auth_rate_reset(text) to service_role;
grant execute on function public.auth_rate_cleanup() to service_role;
