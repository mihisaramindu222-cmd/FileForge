-- FileForge production schema for Supabase Auth, plans, usage and Stripe billing.
-- Run in the Supabase SQL editor once.

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

alter table public.billing_events add column if not exists user_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_plan_idx on public.profiles(plan);
create index if not exists profiles_subscription_idx on public.profiles(stripe_subscription_id);
create index if not exists usage_daily_date_idx on public.usage_daily(usage_date desc);
create index if not exists billing_events_user_idx on public.billing_events(user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.usage_daily enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "usage_select_own" on public.usage_daily;
create policy "usage_select_own" on public.usage_daily for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- One-time admin setup example (replace the email and run once after signup):
-- update public.profiles set role = 'admin' where email = 'you@example.com';

-- Concurrency-safe compression job locks. A lock expires after 20 minutes so a
-- crashed function cannot permanently block a user from submitting another job.
-- Shared rate limiting across Vercel instances. Only a one-way hash of the client bucket is stored.
create table if not exists public.rate_limit_buckets (
  bucket text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0
);

alter table public.rate_limit_buckets enable row level security;

create or replace function public.check_rate_limit(p_bucket text, p_max_requests integer, p_window_seconds integer)
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
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bucket, 0));
  select request_count, window_started_at into current_count, started from public.rate_limit_buckets where bucket = p_bucket for update;
  if started is null or started <= now() - make_interval(secs => p_window_seconds) then
    insert into public.rate_limit_buckets(bucket, window_started_at, request_count) values (p_bucket, now(), 1)
    on conflict (bucket) do update set window_started_at = now(), request_count = 1;
    return jsonb_build_object('allowed', true, 'remaining', greatest(p_max_requests - 1, 0));
  end if;
  if current_count >= p_max_requests then
    return jsonb_build_object('allowed', false, 'remaining', 0);
  end if;
  update public.rate_limit_buckets set request_count = request_count + 1 where bucket = p_bucket;
  return jsonb_build_object('allowed', true, 'remaining', greatest(p_max_requests - current_count - 1, 0));
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

create table if not exists public.active_compression_jobs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now()
);

enable row level security on public.active_compression_jobs;

drop function if exists public.start_compression_job(uuid);

revoke all on function public.finish_compression_job() from public;
revoke all on function public.finish_compression_job() from anon;
revoke all on function public.finish_compression_job() from authenticated;
grant execute on function public.finish_compression_job() to authenticated, service_role;

revoke all on function public.release_compression_job() from public;
revoke all on function public.release_compression_job() from anon;
revoke all on function public.release_compression_job() from authenticated;
grant execute on function public.release_compression_job() to authenticated, service_role;

