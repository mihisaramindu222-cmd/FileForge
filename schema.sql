-- FileForge production schema for Supabase Auth, plans, usage and Stripe billing.
-- Keep this file aligned with the live production RPC signatures.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'member' check (role in ('member','admin')),
  plan text not null default 'free' check (plan in ('free','pro')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_daily (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null default current_date,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, usage_date)
);

create table if not exists public.billing_events (
  event_id text primary key,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  amount_total bigint not null default 0,
  currency text,
  created_at timestamptz not null default now()
);

alter table public.billing_events
  add column if not exists user_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_plan_idx on public.profiles(plan);
create index if not exists profiles_subscription_idx on public.profiles(stripe_subscription_id);
create index if not exists usage_daily_date_idx on public.usage_daily(usage_date desc);
create index if not exists billing_events_user_idx on public.billing_events(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.usage_daily enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "usage_select_own" on public.usage_daily;
create policy "usage_select_own"
  on public.usage_daily
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Admin dashboard data. The RPC is server-only; the server verifies the target
-- user is an admin before returning aggregate dashboard data.
drop function if exists public.get_admin_dashboard();
create or replace function public.get_admin_dashboard(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_role text;
  total_users bigint := 0;
  usage_rows jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  select role into user_role
    from public.profiles
   where id = p_user_id;

  if user_role <> 'admin' then
    raise exception 'Not authorized';
  end if;

  select count(*) into total_users
    from public.profiles;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'usage_date', usage_date,
        'count', count
      )
      order by usage_date desc
    ),
    '[]'::jsonb
  )
  into usage_rows
  from (
    select usage_date, sum(count)::bigint as count
      from public.usage_daily
     group by usage_date
     order by usage_date desc
     limit 14
  ) daily;

  return jsonb_build_object(
    'total_users', total_users,
    'recent_usage', usage_rows
  );
end;
$$;

revoke all on function public.get_admin_dashboard() from public;
revoke all on function public.get_admin_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard(uuid) to service_role;

create table if not exists public.rate_limit_buckets (
  bucket text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0
);

alter table public.rate_limit_buckets enable row level security;

create policy if not exists "rate_limit_buckets_no_client_access"
  on public.rate_limit_buckets
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.check_rate_limit(
  p_bucket text,
  p_max_requests integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  started timestamptz;
begin
  if p_max_requests < 1 or p_window_seconds < 1 then
    return jsonb_build_object('allowed', false);
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bucket, 0)
  );

  select request_count, window_started_at
    into current_count, started
    from public.rate_limit_buckets
   where bucket = p_bucket
   for update;

  if started is null
     or started <= now() - make_interval(secs => p_window_seconds) then
    insert into public.rate_limit_buckets(
      bucket, window_started_at, request_count
    )
    values (p_bucket, now(), 1)
    on conflict (bucket) do update
      set window_started_at = now(),
          request_count = 1;

    return jsonb_build_object(
      'allowed', true,
      'remaining', greatest(p_max_requests - 1, 0)
    );
  end if;

  if current_count >= p_max_requests then
    return jsonb_build_object('allowed', false, 'remaining', 0);
  end if;

  update public.rate_limit_buckets
     set request_count = request_count + 1
   where bucket = p_bucket;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(p_max_requests - current_count - 1, 0)
  );
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

create table if not exists public.active_compression_jobs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now()
);

alter table public.active_compression_jobs enable row level security;

create policy if not exists "active_compression_jobs_no_client_access"
  on public.active_compression_jobs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop function if exists public.start_compression_job();
create or replace function public.start_compression_job(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_started_at timestamptz;
  user_plan text;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  select plan into user_plan
    from public.profiles
   where id = p_user_id;

  if user_plan is null then
    raise exception 'Profile not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select started_at into existing_started_at
    from public.active_compression_jobs
   where user_id = p_user_id
   for update;

  if existing_started_at is not null
     and existing_started_at > now() - interval '20 minutes' then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'busy'
    );
  end if;

  insert into public.active_compression_jobs (user_id, started_at)
  values (p_user_id, now())
  on conflict (user_id) do update
    set started_at = excluded.started_at;

  return jsonb_build_object(
    'allowed', true,
    'plan', user_plan,
    'remaining', null,
    'limit', null
  );
end;
$$;

drop function if exists public.finish_compression_job();
create or replace function public.finish_compression_job(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_plan text;
  used_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if not exists (
    select 1
      from public.active_compression_jobs
     where user_id = p_user_id
  ) then
    raise exception 'No active compression job';
  end if;

  select plan into user_plan
    from public.profiles
   where id = p_user_id;

  if user_plan is null then
    raise exception 'Profile not found';
  end if;

  insert into public.usage_daily (user_id, usage_date, count)
  values (p_user_id, current_date, 0)
  on conflict (user_id, usage_date) do nothing;

  select count into used_count
    from public.usage_daily
   where user_id = p_user_id
     and usage_date = current_date
   for update;

  update public.usage_daily
     set count = count + 1
   where user_id = p_user_id
     and usage_date = current_date;

  delete from public.active_compression_jobs
   where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', true,
    'plan', user_plan,
    'remaining', null,
    'limit', null,
    'used_today', used_count + 1
  );
end;
$$;

drop function if exists public.release_compression_job();
create or replace function public.release_compression_job(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.active_compression_jobs
   where user_id = p_user_id;
$$;

drop function if exists public.start_compression_job(uuid);
drop function if exists public.finish_compression_job(uuid);
drop function if exists public.release_compression_job(uuid);

revoke all on function public.start_compression_job(uuid) from public, anon, authenticated;
grant execute on function public.start_compression_job(uuid) to service_role;

revoke all on function public.finish_compression_job(uuid) from public, anon, authenticated;
grant execute on function public.finish_compression_job(uuid) to service_role;

revoke all on function public.release_compression_job(uuid) from public, anon, authenticated;
grant execute on function public.release_compression_job(uuid) to service_role;
