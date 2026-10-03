-- For the existing NigraanOS profiles/incidents/evidence schema.
-- Run this file only; it preserves tables, columns and legacy data.
-- The transaction rolls back on incompatible pre-existing constraints.
begin;

alter table public.profiles add column if not exists account_type text not null default 'citizen';
alter table public.profiles add constraint nigraan_account_type_check
  check (account_type in ('citizen','operations')) not valid;

create table if not exists public.operations_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  organization_name text not null check (length(trim(organization_name)) between 1 and 200),
  organization_type text not null default 'other'
    check (organization_type in ('government','ngo','civic_organization','utility','volunteer_group','other')),
  verification_status text not null default 'pending'
    check (verification_status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.incidents add column if not exists priority text not null default 'normal';
alter table public.incidents add column if not exists area text;
alter table public.incidents add column if not exists assigned_organization_id uuid references public.operations_profiles(user_id);
-- Existing rows retain submitted visibility. Only the new RPC can create drafts.
alter table public.incidents add column if not exists submission_state text not null default 'submitted';
alter table public.incidents add constraint nigraan_priority_check
  check (priority in ('low','normal','medium','high','critical')) not valid;
alter table public.incidents add constraint nigraan_workflow_check
  check (status in ('reported','acknowledged','assigned','in_progress','resolved')) not valid;
alter table public.incidents add constraint nigraan_submission_state_check
  check (submission_state in ('draft','submitted')) not valid;
alter table public.evidence add column if not exists transcript text;
alter table public.evidence add column if not exists transcription_status text not null default 'not_connected';
alter table public.evidence add constraint nigraan_transcription_status_check
  check (transcription_status in ('not_connected','pending','ready','failed','confirmed')) not valid;
create index if not exists nigraan_incidents_reporter_date on public.incidents(reporter_id, reported_at desc);
create index if not exists nigraan_incidents_submission_date on public.incidents(submission_state, reported_at desc);
create index if not exists nigraan_evidence_incident on public.evidence(incident_id);

-- Deferred until existing signup triggers finish. Existing display_name/email/
-- phone/avatar data is preserved. Signup metadata can request an unprivileged
-- account type; it cannot choose verification, priority, or a privileged role.
create or replace function public.nigraan_create_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name, account_type)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),
    nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Citizen'), 'citizen')
  on conflict (id) do nothing;
  update public.profiles set account_type='citizen' where id=new.id;
  if new.raw_user_meta_data->>'account_type' = 'operations' then
    update public.profiles set account_type='operations' where id=new.id;
    insert into public.operations_profiles(user_id,organization_name,organization_type,verification_status)
    values (new.id, new.raw_user_meta_data->>'organization_name',
      coalesce(new.raw_user_meta_data->>'organization_type','other'), 'pending')
    on conflict (user_id) do update set verification_status='pending', organization_name=excluded.organization_name, organization_type=excluded.organization_type;
  end if;
  return new;
end;
$$;
revoke all on function public.nigraan_create_account() from public, anon, authenticated;
create constraint trigger nigraan_account_after_signup
after insert on auth.users deferrable initially deferred
for each row execute function public.nigraan_create_account();

create or replace function public.is_approved_operations()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.operations_profiles o join public.profiles p on p.id=o.user_id
    where o.user_id=(select auth.uid()) and p.account_type='operations'
      and o.verification_status='approved'
  );
$$;
revoke all on function public.is_approved_operations() from public, anon, authenticated;
grant execute on function public.is_approved_operations() to authenticated;

create or replace function public.nigraan_can_read_incident(incident uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.incidents i
    where i.id=incident and (
      i.reporter_id=(select auth.uid())
      or (i.submission_state='submitted' and public.is_approved_operations())
    )
  );
$$;
create or replace function public.nigraan_owns_draft(incident uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.incidents i join public.profiles p on p.id=i.reporter_id
    where i.id=incident and i.reporter_id=(select auth.uid())
      and p.account_type='citizen' and i.submission_state='draft'
  );
$$;
revoke all on function public.nigraan_can_read_incident(uuid), public.nigraan_owns_draft(uuid) from public, anon, authenticated;
grant execute on function public.nigraan_can_read_incident(uuid), public.nigraan_owns_draft(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.operations_profiles enable row level security;
alter table public.incidents enable row level security;
alter table public.evidence enable row level security;

-- Retain older policies but add RESTRICTIVE guards: older permissive policies
-- cannot widen access. Revoke old table AND column-level browser write grants.
revoke all on public.profiles, public.operations_profiles, public.incidents, public.evidence from public, anon, authenticated;
do $$
declare t text; c record; r text;
begin
  foreach t in array array['profiles','operations_profiles','incidents','evidence'] loop
    for c in select column_name from information_schema.columns where table_schema='public' and table_name=t loop
      foreach r in array array['public','anon','authenticated'] loop
        execute format('revoke all (%I) on public.%I from %s',c.column_name,t,r);
      end loop;
    end loop;
  end loop;
end $$;
grant select on public.profiles, public.operations_profiles, public.incidents, public.evidence to authenticated;
grant update(display_name, phone, avatar_url) on public.profiles to authenticated;

create policy nigraan_profile_read on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy nigraan_profile_read_guard on public.profiles as restrictive for select to public using (id=(select auth.uid()));
create policy nigraan_profile_update on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy nigraan_profile_update_guard on public.profiles as restrictive for update to public using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy nigraan_profile_insert_guard on public.profiles as restrictive for insert to public with check (false);
create policy nigraan_profile_delete_guard on public.profiles as restrictive for delete to public using (false);

create policy nigraan_operations_read on public.operations_profiles for select to authenticated using (user_id=(select auth.uid()));
create policy nigraan_operations_read_guard on public.operations_profiles as restrictive for select to public using (user_id=(select auth.uid()));
create policy nigraan_operations_insert_guard on public.operations_profiles as restrictive for insert to public with check (false);
create policy nigraan_operations_update_guard on public.operations_profiles as restrictive for update to public using (false) with check (false);
create policy nigraan_operations_delete_guard on public.operations_profiles as restrictive for delete to public using (false);

create policy nigraan_incident_read on public.incidents for select to authenticated using (public.nigraan_can_read_incident(id));
create policy nigraan_incident_read_guard on public.incidents as restrictive for select to public using (public.nigraan_can_read_incident(id));
create policy nigraan_incident_insert_guard on public.incidents as restrictive for insert to public with check (false);
create policy nigraan_incident_update_guard on public.incidents as restrictive for update to public using (false) with check (false);
create policy nigraan_incident_delete_guard on public.incidents as restrictive for delete to public using (false);
create policy nigraan_evidence_read on public.evidence for select to authenticated using (public.nigraan_can_read_incident(incident_id));
create policy nigraan_evidence_read_guard on public.evidence as restrictive for select to public using (public.nigraan_can_read_incident(incident_id));
create policy nigraan_evidence_insert_guard on public.evidence as restrictive for insert to public with check (false);
create policy nigraan_evidence_update_guard on public.evidence as restrictive for update to public using (false) with check (false);
create policy nigraan_evidence_delete_guard on public.evidence as restrictive for delete to public using (false);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('incident-evidence','incident-evidence',false,10485760,
  array['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=excluded.allowed_mime_types;

-- Paths are <authenticated-user-uuid>/<incident-uuid>/<random-file-name>.
-- Cast only after a UUID regex check, so malformed names return false.
create or replace function public.nigraan_storage_access(object_name text, mode text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare incident uuid; path_parts text[];
begin
  path_parts := string_to_array(object_name,'/');
  if array_length(path_parts,1) <> 3
    or path_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or path_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or path_parts[3]='' then return false; end if;
  incident := path_parts[2]::uuid;
  if mode='write' then
    return path_parts[1]=(select auth.uid())::text and public.nigraan_owns_draft(incident);
  elsif mode='read' then
    return exists (select 1 from public.incidents i where i.id=incident
      and i.reporter_id::text=path_parts[1] and public.nigraan_can_read_incident(i.id));
  end if;
  return false;
end;
$$;
revoke all on function public.nigraan_storage_access(text,text) from public, anon, authenticated;
grant execute on function public.nigraan_storage_access(text,text) to anon, authenticated;
create policy nigraan_storage_read on storage.objects for select to authenticated
using (bucket_id='incident-evidence' and public.nigraan_storage_access(name,'read'));
create policy nigraan_storage_read_guard on storage.objects as restrictive for select to public
using (bucket_id<>'incident-evidence' or public.nigraan_storage_access(name,'read'));
create policy nigraan_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='incident-evidence' and public.nigraan_storage_access(name,'write'));
create policy nigraan_storage_insert_guard on storage.objects as restrictive for insert to public
with check (bucket_id<>'incident-evidence' or public.nigraan_storage_access(name,'write'));
create policy nigraan_storage_delete on storage.objects for delete to authenticated
using (bucket_id='incident-evidence' and public.nigraan_storage_access(name,'write'));
create policy nigraan_storage_delete_guard on storage.objects as restrictive for delete to public
using (bucket_id<>'incident-evidence' or public.nigraan_storage_access(name,'write'));
create policy nigraan_storage_update_guard on storage.objects as restrictive for update to public
using (bucket_id<>'incident-evidence') with check (bucket_id<>'incident-evidence');

create or replace function public.nigraan_begin_incident(
  incident_id uuid, incident_title text, incident_description text, incident_category text,
  incident_area text, gps_latitude double precision, gps_longitude double precision,
  gps_accuracy double precision
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=(select auth.uid()) and account_type='citizen')
    then raise exception 'Citizen account required'; end if;
  if length(trim(incident_title)) not between 1 and 160
    or length(trim(incident_description)) not between 1 and 5000
    or length(trim(incident_area)) not between 1 and 200
    or incident_title is null or incident_description is null or incident_area is null
    then raise exception 'Valid title, description and area required'; end if;
  if incident_category is null or incident_category not in
    ('traffic','flood','garbage','air_quality','water','power','road_damage','other')
    then raise exception 'Invalid category'; end if;
  if gps_latitude is null or gps_longitude is null or gps_accuracy is null
    or not (gps_latitude between -90 and 90) or not (gps_longitude between -180 and 180)
    or gps_accuracy < 0 or gps_accuracy='NaN'::double precision or gps_accuracy='Infinity'::double precision
    then raise exception 'Valid GPS coordinates and accuracy required'; end if;
  insert into public.incidents(id,reporter_id,title,description,category,status,
    latitude,longitude,location_accuracy,reported_at,updated_at,area,priority,submission_state)
  values(incident_id,(select auth.uid()),trim(incident_title),trim(incident_description),
    incident_category,'reported',gps_latitude,gps_longitude,gps_accuracy,now(),now(),trim(incident_area),'normal','draft');
  return incident_id;
end;
$$;

create or replace function public.nigraan_finalize_incident(incident uuid, attachments jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.incidents; item jsonb; object_meta jsonb; mime text; bytes integer;
  seen text[] := array[]::text[]; has_photo boolean := false; file_path text;
begin
  select * into i from public.incidents where id=incident and reporter_id=(select auth.uid()) for update;
  if not found then raise exception 'Incident not found'; end if;
  if not exists(select 1 from public.profiles where id=(select auth.uid()) and account_type='citizen')
    then raise exception 'Citizen account required'; end if;
  -- Idempotent retry after a lost network response.
  if i.submission_state='submitted' then return incident; end if;
  if jsonb_typeof(attachments) is distinct from 'array' then raise exception 'Evidence array required'; end if;
  if jsonb_array_length(attachments) not between 1 and 6 then raise exception 'One to six evidence files required'; end if;
  for item in select value from jsonb_array_elements(attachments) loop
    file_path := item->>'storage_path';
    if file_path is null or file_path=any(seen) or not public.nigraan_storage_access(file_path,'write')
      or split_part(file_path,'/',2)<>incident::text then raise exception 'Invalid evidence ownership or duplicate path'; end if;
    seen := array_append(seen,file_path);
    select metadata into object_meta from storage.objects where bucket_id='incident-evidence' and name=file_path;
    if not found then raise exception 'Evidence upload missing'; end if;
    mime := split_part(object_meta->>'mimetype',';',1);
    bytes := (object_meta->>'size')::integer;
    if mime is null or bytes is null or bytes<=0 then raise exception 'Invalid upload metadata'; end if;
    if mime in ('image/jpeg','image/png','image/webp') then
      if bytes>5242880 then raise exception 'Photo exceeds 5 MB'; end if;
      if item->>'source' is null or item->>'source' not in ('camera','upload') then raise exception 'Invalid photo source'; end if;
      has_photo := true;
    elsif mime in ('audio/webm','audio/ogg','audio/mp4') then
      if bytes>10485760 or item->>'source' is distinct from 'recording' then raise exception 'Invalid voice recording'; end if;
    else raise exception 'Unsupported evidence type'; end if;
    insert into public.evidence(incident_id,uploader_id,storage_path,media_type,source,file_size,created_at,transcription_status)
    values(incident,(select auth.uid()),file_path,mime,item->>'source',bytes,now(),'not_connected');
  end loop;
  if not has_photo then raise exception 'At least one uploaded photo is required'; end if;
  update public.incidents set submission_state='submitted',updated_at=now() where id=incident;
  return incident;
end;
$$;

create or replace function public.nigraan_abandon_draft(incident uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.incidents where id=incident and reporter_id=(select auth.uid()) and submission_state='draft' for update;
  if not found then return false; end if;
  if exists(select 1 from storage.objects where bucket_id='incident-evidence'
    and split_part(name,'/',2)=incident::text) then raise exception 'Remove draft uploads through Storage before cleanup'; end if;
  -- Cleanup ONLY a newly created, self-owned draft. Never delete legacy/finalized incidents.
  delete from public.evidence where incident_id=incident;
  delete from public.incidents where id=incident;
  return true;
end;
$$;
revoke all on function public.nigraan_begin_incident(uuid,text,text,text,text,double precision,double precision,double precision),
 public.nigraan_finalize_incident(uuid,jsonb), public.nigraan_abandon_draft(uuid) from public, anon, authenticated;
grant execute on function public.nigraan_begin_incident(uuid,text,text,text,text,double precision,double precision,double precision),
 public.nigraan_finalize_incident(uuid,jsonb), public.nigraan_abandon_draft(uuid) to authenticated;

-- The prototype public.reports table and its rows are intentionally untouched.
commit;



