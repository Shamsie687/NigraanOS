-- Run once in a new Supabase project's SQL Editor as the project owner.
-- Transactional: failures roll back the whole migration.
begin;

create type public.account_type as enum ('citizen', 'operations');
create type public.organization_type as enum ('government', 'ngo', 'civic_organization', 'utility', 'volunteer_group', 'other');
create type public.verification_status as enum ('pending', 'approved', 'rejected');
create type public.report_category as enum ('traffic', 'flood', 'garbage', 'air_quality', 'water', 'power', 'road_damage', 'other');
create type public.report_status as enum ('submitted', 'acknowledged', 'assigned', 'in_progress', 'resolved');
create type public.report_priority as enum ('low', 'normal', 'medium', 'high', 'critical');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  account_type public.account_type not null default 'citizen',
  created_at timestamptz not null default now()
);
create table public.operations_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organization_name text not null check (length(trim(organization_name)) between 1 and 200),
  organization_type public.organization_type not null default 'other',
  verification_status public.verification_status not null default 'pending',
  created_at timestamptz not null default now()
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  citizen_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  description text not null check (length(trim(description)) between 1 and 5000),
  category public.report_category not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  area text not null check (length(trim(area)) between 1 and 200),
  image_url text,
  status public.report_status not null default 'submitted',
  priority public.report_priority not null default 'normal',
  -- In this MVP each approved organization is represented by its Operations
  -- account. A future multi-member organizations table can replace this FK.
  assigned_organization_id uuid references public.operations_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create index reports_citizen_created_idx on public.reports(citizen_id, created_at desc);
create index reports_created_idx on public.reports(created_at desc);
create index reports_status_priority_idx on public.reports(status, priority);
create index reports_assignment_idx on public.reports(assigned_organization_id);

-- Metadata may choose an UNPRIVILEGED account type, never approval.
-- No user-supplied role or verification value is read.
create function public.handle_new_nigraan_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  chosen_type public.account_type;
begin
  chosen_type := case when new.raw_user_meta_data->>'account_type' = 'operations'
    then 'operations'::public.account_type else 'citizen'::public.account_type end;
  insert into public.profiles(id, full_name, account_type)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'Citizen'), chosen_type);
  if chosen_type = 'operations' then
    insert into public.operations_profiles(user_id, organization_name, organization_type, verification_status)
    values (new.id, new.raw_user_meta_data->>'organization_name',
      coalesce(new.raw_user_meta_data->>'organization_type', 'other')::public.organization_type, 'pending');
  end if;
  return new;
end;
$$;
revoke all on function public.handle_new_nigraan_user() from public, anon, authenticated;
create trigger on_nigraan_user_created after insert on auth.users
for each row execute function public.handle_new_nigraan_user();

create function public.set_report_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.set_report_updated_at() from public, anon, authenticated;
create trigger reports_updated_at before update on public.reports
for each row execute function public.set_report_updated_at();

-- No caller-selected user ID. Reads trusted database state on every request,
-- so approval/revocation is effective without waiting for a JWT refresh.
create function public.is_approved_operations()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.operations_profiles o
    join public.profiles p on p.id = o.user_id
    where o.user_id = (select auth.uid())
      and p.account_type = 'operations' and o.verification_status = 'approved'
  );
$$;
revoke all on function public.is_approved_operations() from public, anon, authenticated;
grant execute on function public.is_approved_operations() to authenticated;

alter table public.profiles enable row level security;
alter table public.operations_profiles enable row level security;
alter table public.reports enable row level security;

-- Reset Supabase default table grants before issuing narrow privileges.
revoke all on public.profiles, public.operations_profiles, public.reports from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.operations_profiles, public.reports to authenticated;
grant insert (id, full_name, account_type) on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant insert (user_id, organization_name, organization_type) on public.operations_profiles to authenticated;
grant update (organization_name, organization_type) on public.operations_profiles to authenticated;
grant insert (citizen_id, title, description, category, latitude, longitude, area) on public.reports to authenticated;

create policy profiles_read_own on public.profiles for select to authenticated
using (id = (select auth.uid()));
-- Signup trigger normally creates this row. Safe self-profile fallback permits
-- citizens only; account_type cannot subsequently be updated by the browser.
create policy profiles_insert_citizen_self on public.profiles for insert to authenticated
with check (id = (select auth.uid()) and account_type = 'citizen');
create policy profiles_update_name_self on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy operations_read_own on public.operations_profiles for select to authenticated
using (user_id = (select auth.uid()));
create policy operations_insert_pending_self on public.operations_profiles for insert to authenticated
with check (
  user_id = (select auth.uid()) and verification_status = 'pending'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.account_type = 'operations')
);
create policy operations_update_pending_details_self on public.operations_profiles for update to authenticated
using (user_id = (select auth.uid()) and verification_status = 'pending')
with check (user_id = (select auth.uid()) and verification_status = 'pending');

create policy reports_insert_citizen_self on public.reports for insert to authenticated
with check (
  citizen_id = (select auth.uid()) and status = 'submitted' and priority = 'normal'
  and assigned_organization_id is null and image_url is null
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.account_type = 'citizen')
);
create policy reports_read_citizen_own on public.reports for select to authenticated
using (
  citizen_id = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.account_type = 'citizen')
);
create policy reports_read_approved_operations on public.reports for select to authenticated
using ((select public.is_approved_operations()));
-- No report UPDATE/DELETE grants or policies for any browser user.
-- Approval, status, priority and assignment changes require trusted server/admin
-- tooling. No service-role credentials belong in the frontend.
commit;
