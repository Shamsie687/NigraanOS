-- NEW EMPTY HACKATHON PROJECT ONLY. Never apply to production or M4E.
-- Reviewed candidate established-schema baseline for release 9b242aa.
-- Not a production clone. Managed Auth/Storage are prerequisites, not recreated.
begin;
set local lock_timeout = '10s';
do $$
begin
  if current_user <> 'postgres' then raise exception 'Project owner postgres required'; end if;
  if to_regclass('auth.users') is null or to_regclass('storage.buckets') is null
    or to_regclass('storage.objects') is null then raise exception 'Managed Auth/Storage required'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','S','f')) then
    raise exception 'Public schema must be empty; do not reuse an existing project';
  end if;
  if exists(select 1 from auth.users) or exists(select 1 from storage.buckets) then
    raise exception 'Fresh project without users or buckets required';
  end if;
end $$;

-- Opt-in privileges on all subsequent postgres-owned application objects.
-- Global defaults must also be revoked: schema revocation alone is insufficient.
alter default privileges for role postgres revoke all on tables from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke all on tables from public,anon,authenticated,service_role;
alter default privileges for role postgres revoke all on sequences from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke all on sequences from public,anon,authenticated,service_role;
alter default privileges for role postgres revoke all on functions from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke all on functions from public,anon,authenticated,service_role;
revoke create on schema public from public,anon,authenticated,service_role;
grant usage on schema public to authenticated,service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text, phone text, avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 160),
  description text not null check(length(trim(description)) between 1 and 5000),
  category text not null,
  status text not null default 'reported',
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  location_accuracy double precision check(location_accuracy>=0),
  reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null check(length(storage_path) between 1 and 500),
  media_type text not null, source text not null,
  file_size integer not null check(file_size between 1 and 10485760),
  created_at timestamptz not null default now()
);
-- Empty compatibility object required by 011, including reports_id_seq.
-- This is not historical 001 and contains no legacy data or permissive policies.
create table public.reports(id bigint generated always as identity primary key,body text);
alter table public.profiles enable row level security;
alter table public.incidents enable row level security;
alter table public.evidence enable row level security;
alter table public.reports enable row level security;
revoke all on public.profiles,public.incidents,public.evidence,public.reports from public,anon,authenticated,service_role;
revoke all on sequence public.reports_id_seq from public,anon,authenticated,service_role;
-- 002 creates the deferred Auth signup trigger; 005 supplies final Citizen-only
-- signup behavior. No additional Auth trigger or lifecycle timestamp invented.
-- Fresh-project timestamp behavior. This is NOT the old production SECURITY
-- DEFINER helper hardened by 018. Keep this new helper invoker-only and pinned;
-- 018 is original-project-only and must not be replayed on this fresh baseline.
create function public.handle_updated_at() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger on_incident_updated before update on public.incidents
for each row execute function public.handle_updated_at();
create trigger on_profile_updated before update on public.profiles
for each row execute function public.handle_updated_at();
commit;
