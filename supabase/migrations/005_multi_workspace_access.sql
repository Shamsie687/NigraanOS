-- Apply after deployed 002/003/004. Preserve all accounts, applications, incidents,
-- evidence and Storage files. account_type remains as a legacy compatibility field;
-- it no longer grants or restricts workspace access. No RLS/bucket policy changes.
begin;
set local lock_timeout='10s';
alter table public.operations_profiles add column if not exists explanation text;
alter table public.operations_profiles drop constraint if exists nigraan_operations_explanation_check;
alter table public.operations_profiles add constraint nigraan_operations_explanation_check
  check(explanation is null or length(explanation)<=1000) not valid;

create or replace function public.nigraan_create_account()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name,account_type)
  values(new.id,coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),
    nullif(trim(new.raw_user_meta_data->>'full_name'),''),'Citizen'),'citizen')
  on conflict(id) do nothing;
  -- For this NEW signup only: editable signup metadata cannot select privileges.
  update public.profiles set account_type='citizen' where id=new.id;
  -- An older signup trigger may also insert an organization for this NEW user.
  -- Such an application must never gain approval from editable signup metadata.
  update public.operations_profiles set verification_status='pending' where user_id=new.id;
  return new;
end;
$$;

create or replace function public.is_approved_operations()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.operations_profiles o join public.profiles p on p.id=o.user_id
    where o.user_id=(select auth.uid()) and o.verification_status='approved');
$$;
create or replace function public.nigraan_owns_draft(incident uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.incidents i join public.profiles p on p.id=i.reporter_id
    where i.id=incident and i.reporter_id=(select auth.uid()) and i.submission_state='draft');
$$;

create or replace function public.nigraan_apply_operations(
  organization_name text, organization_type text, explanation text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor_id uuid := (select auth.uid()); existing_status text;
begin
  if actor_id is null then raise exception 'Sign in to apply'; end if;
  -- Serialize applications for the same identity; no supplied target user ID.
  perform 1 from public.profiles p where p.id=actor_id for update;
  if not found then raise exception 'Account profile required'; end if;
  if organization_name is null or length(trim(organization_name)) not between 1 and 200
    then raise exception 'Organization name must contain 1 to 200 characters'; end if;
  if organization_type is null or organization_type not in
    ('government','ngo','civic_organization','utility','volunteer_group','other')
    then raise exception 'Invalid organization type'; end if;
  if explanation is not null and length(trim(explanation))>1000
    then raise exception 'Explanation must not exceed 1000 characters'; end if;
  select o.verification_status into existing_status from public.operations_profiles o where o.user_id=actor_id for update;
  if existing_status='approved' then raise exception 'Operations access is already approved'; end if;
  if existing_status='pending' then raise exception 'Operations application is already pending'; end if;
  insert into public.operations_profiles as o(user_id,organization_name,organization_type,explanation,verification_status)
  values(actor_id,trim(organization_name),organization_type,nullif(trim(explanation),''),'pending')
  on conflict(user_id) do update set organization_name=excluded.organization_name,
    organization_type=excluded.organization_type,explanation=excluded.explanation,verification_status='pending';
  return actor_id;
end;
$$;

create or replace function public.nigraan_update_incident_status(
  incident uuid, expected_status text, next_status text
) returns uuid language plpgsql security definer set search_path='' as $$
declare current_status text; allowed_next text;
begin
  if not public.is_approved_operations() then raise exception 'Approved Operations access required'; end if;
  select i.status into current_status from public.incidents i
    where i.id=incident and i.submission_state='submitted' for update;
  if not found then raise exception 'Submitted incident not found'; end if;
  if current_status is distinct from expected_status then raise exception 'Status changed. Refresh this incident before trying again'; end if;
  allowed_next := case current_status when 'reported' then 'acknowledged'
    when 'acknowledged' then 'assigned' when 'assigned' then 'in_progress'
    when 'in_progress' then 'resolved' else null end;
  if allowed_next is null or next_status is distinct from allowed_next
    then raise exception 'Invalid workflow transition'; end if;
  -- Initial assignment is to the acting approved organization's profile.
  update public.incidents set status=next_status,updated_at=now(),
    assigned_organization_id=case when next_status='assigned' then (select auth.uid()) else assigned_organization_id end
  where id=incident;
  return incident;
end;
$$;
revoke all on function public.nigraan_create_account(),public.is_approved_operations(),public.nigraan_owns_draft(uuid),
  public.nigraan_apply_operations(text,text,text),public.nigraan_update_incident_status(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.is_approved_operations(),public.nigraan_owns_draft(uuid),
  public.nigraan_apply_operations(text,text,text),public.nigraan_update_incident_status(uuid,text,text) to authenticated;

-- The current begin/finalize RPCs below retain GPS, photo, MIME, source, size,
-- ownership, draft and transactional checks; only the account_type gate is removed.

create or replace function public.nigraan_begin_incident(
  incident_id uuid, incident_title text, incident_description text, incident_category text,
  incident_area text, gps_latitude double precision, gps_longitude double precision,
  gps_accuracy double precision
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=(select auth.uid()))
    then raise exception 'Account profile required'; end if;
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
declare i public.incidents; item jsonb; object_meta jsonb; mime text; kind text; bytes integer;
  seen text[] := array[]::text[]; has_photo boolean := false; file_path text;
begin
  select * into i from public.incidents where id=incident and reporter_id=(select auth.uid()) for update;
  if not found then raise exception 'Incident not found'; end if;
  if not exists(select 1 from public.profiles where id=(select auth.uid()))
    then raise exception 'Account profile required'; end if;
  if i.submission_state='submitted' then return incident; end if;
  if i.submission_state is distinct from 'draft' then raise exception 'Incident is not a draft'; end if;
  if jsonb_typeof(attachments) is distinct from 'array' then raise exception 'Evidence array required'; end if;
  if jsonb_array_length(attachments) not between 1 and 6 then raise exception 'One to six evidence files required'; end if;
  for item in select value from jsonb_array_elements(attachments) loop
    file_path := item->>'storage_path';
    if file_path is null or file_path=any(seen) or not public.nigraan_storage_access(file_path,'write')
      or split_part(file_path,'/',2)<>incident::text then raise exception 'Invalid evidence ownership or duplicate path'; end if;
    seen := array_append(seen,file_path);
    select metadata into object_meta from storage.objects where bucket_id='incident-evidence' and name=file_path;
    if not found then raise exception 'Evidence upload missing'; end if;
    mime := lower(trim(split_part(object_meta->>'mimetype',';',1)));
    bytes := (object_meta->>'size')::integer;
    if mime is null or bytes is null or bytes<=0 then raise exception 'Invalid upload metadata'; end if;
    if mime in ('image/jpeg','image/png','image/webp') then
      kind := 'image';
      if bytes>5242880 then raise exception 'Photo exceeds 5 MB'; end if;
      if item->>'source' is null or item->>'source' not in ('camera','upload') then raise exception 'Invalid photo source'; end if;
      has_photo := true;
    elsif mime in ('audio/webm','audio/ogg','audio/mp4') then
      kind := 'audio';
      if bytes>10485760 or item->>'source' is distinct from 'recording' then raise exception 'Invalid voice recording'; end if;
    else raise exception 'Unsupported evidence type'; end if;
    insert into public.evidence(incident_id,uploader_id,storage_path,media_type,mime_type,source,file_size,created_at,transcription_status)
    values(incident,(select auth.uid()),file_path,kind,mime,item->>'source',bytes,now(),'not_connected');
  end loop;
  if not has_photo then raise exception 'At least one uploaded photo is required'; end if;
  update public.incidents set submission_state='submitted',updated_at=now() where id=incident;
  return incident;
end;
$$;

revoke all on function public.nigraan_begin_incident(uuid,text,text,text,text,double precision,double precision,double precision),
  public.nigraan_finalize_incident(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.nigraan_begin_incident(uuid,text,text,text,text,double precision,double precision,double precision),
  public.nigraan_finalize_incident(uuid,jsonb) to authenticated;
commit;
