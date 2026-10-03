-- Run once after deployed 007. No existing incidents/evidence/jobs are rewritten.
begin;
set local lock_timeout='10s';
create table public.nigraan_citizen_changes (
  id uuid primary key,
  incident_id uuid not null references public.incidents(id),
  citizen_id uuid not null references public.profiles(id),
  kind text not null check(kind in ('edit','update')),
  submission_state text not null default 'draft' check(submission_state in ('draft','published')),
  body text not null default '' check(char_length(body)<=5000),
  proposed_fields jsonb,
  expected_updated_at timestamptz,
  original_snapshot jsonb,
  previous_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create index nigraan_citizen_changes_incident on public.nigraan_citizen_changes(incident_id,published_at,id);
alter table public.evidence add column citizen_change_id uuid references public.nigraan_citizen_changes(id);
create index nigraan_evidence_change on public.evidence(citizen_change_id);
alter table public.nigraan_citizen_changes enable row level security;
revoke all on public.nigraan_citizen_changes from public,anon,authenticated;
grant select on public.nigraan_citizen_changes to authenticated;
create policy nigraan_citizen_changes_read on public.nigraan_citizen_changes for select to authenticated
  using((submission_state='published' and public.nigraan_can_read_incident(incident_id))
    or (submission_state='draft' and citizen_id=(select auth.uid())));
-- Existing evidence SELECT policies already use the parent incident permission.
-- Existing restrictive evidence/browser-write guards remain untouched.

create function public.nigraan_validate_citizen_fields(fields jsonb)
returns void language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(fields) is distinct from 'object' then raise exception 'Report fields required'; end if;
  if exists(select 1 from jsonb_object_keys(fields) k where k not in
    ('title','description','category','area','latitude','longitude','location_accuracy')) then raise exception 'Only citizen-controlled report fields may be edited'; end if;
  if jsonb_typeof(fields->'title') is distinct from 'string' or char_length(trim(fields->>'title')) not between 1 and 160
    or jsonb_typeof(fields->'description') is distinct from 'string' or char_length(trim(fields->>'description')) not between 1 and 5000
    or jsonb_typeof(fields->'area') is distinct from 'string' or char_length(trim(fields->>'area')) not between 1 and 200
    or fields->>'category' is null or fields->>'category' not in ('traffic','flood','garbage','air_quality','water','power','road_damage','other')
    then raise exception 'Enter a valid title, description, category and area'; end if;
  if jsonb_typeof(fields->'latitude') is distinct from 'number' or jsonb_typeof(fields->'longitude') is distinct from 'number'
    or (fields->>'latitude')::double precision not between -90 and 90 or (fields->>'longitude')::double precision not between -180 and 180
    then raise exception 'Valid GPS coordinates required'; end if;
  if fields->>'location_accuracy' is not null and (jsonb_typeof(fields->'location_accuracy')<>'number' or (fields->>'location_accuracy')::double precision<0)
    then raise exception 'Invalid GPS accuracy'; end if;
end;
$$;
revoke all on function public.nigraan_validate_citizen_fields(jsonb) from public,anon,authenticated;

create function public.nigraan_begin_citizen_change(change_id uuid,incident uuid,change_kind text,fields jsonb,update_text text,expected_version timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.incidents;
begin
  select * into i from public.incidents where id=incident and reporter_id=(select auth.uid()) and submission_state='submitted' for update;
  if not found then raise exception 'Your submitted report was not found'; end if;
  if change_kind='edit' then
    if i.status<>'reported' then raise exception using errcode='PT409',message='This report is already being processed. The original report can no longer be edited. Add an update instead.'; end if;
    if expected_version is null or i.updated_at is distinct from expected_version then raise exception using errcode='PT409',message='This report changed. Refresh it before editing.'; end if;
    perform public.nigraan_validate_citizen_fields(fields);
  elsif change_kind='update' then
    if i.status not in ('acknowledged','assigned','in_progress') then raise exception using errcode='PT409',message='Updates are available only while Operations is processing your report. Refresh its status.'; end if;
    if fields is not null then raise exception 'Updates cannot rewrite the original report'; end if;
    if update_text is null or char_length(trim(update_text)) not between 1 and 5000 then raise exception 'Enter an update up to 5000 characters'; end if;
  else raise exception 'Invalid citizen action'; end if;
  insert into public.nigraan_citizen_changes(id,incident_id,citizen_id,kind,body,proposed_fields,expected_updated_at)
    values(change_id,incident,(select auth.uid()),change_kind,case when change_kind='update' then trim(update_text) else '' end,fields,expected_version);
  return change_id;
end;
$$;

-- Preserve three-part incident paths. New activity uses a separate four-part
-- namespace <owner>/<incident>/<change-draft>/<file> so crafted UUID collisions
-- cannot make old finalized evidence writable via a different draft type.
create or replace function public.nigraan_storage_access(object_name text,mode text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare entity uuid; parts text[];
begin
  parts:=string_to_array(object_name,'/');
  if array_length(parts,1) not in (3,4) or parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or parts[3]='' then return false; end if;
  entity:=parts[2]::uuid;
  if array_length(parts,1)=3 then
    if mode='write' then return parts[1]=(select auth.uid())::text and public.nigraan_owns_draft(entity);
    elsif mode='read' then return exists(select 1 from public.incidents i where i.id=entity and i.reporter_id::text=parts[1] and public.nigraan_can_read_incident(i.id));
    end if;
    return false;
  end if;
  if parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or parts[4]='' then return false; end if;
  if mode='write' then
    return parts[1]=(select auth.uid())::text and exists(
      select 1 from public.nigraan_citizen_changes c join public.incidents i on i.id=c.incident_id
      where c.id=parts[3]::uuid and c.incident_id=entity and c.citizen_id=(select auth.uid()) and i.reporter_id=c.citizen_id and c.submission_state='draft');
  elsif mode='read' then
    return exists(select 1 from public.nigraan_citizen_changes c where c.id=parts[3]::uuid and c.incident_id=entity and c.citizen_id::text=parts[1]
        and ((c.submission_state='published' and public.nigraan_can_read_incident(c.incident_id)) or (c.submission_state='draft' and c.citizen_id=(select auth.uid()))));
  end if;
  return false;
end;
$$;

create function public.nigraan_finalize_citizen_change(change_id uuid,attachments jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.nigraan_citizen_changes; i public.incidents; item jsonb; meta jsonb;
  mime text; kind text; bytes integer; path text; seen text[]:=array[]::text[];
  evidence_id uuid; job public.nigraan_transcription_jobs; corrected text; reviewed boolean;
  snapshot jsonb; proposed jsonb; before_values jsonb:='{}'; after_values jsonb:='{}'; key text;
begin
  -- Always acquire the incident lock before the change lock, matching Operations.
  select * into c from public.nigraan_citizen_changes where id=change_id and citizen_id=(select auth.uid());
  if not found then raise exception 'Citizen draft not found'; end if;
  select * into i from public.incidents where id=c.incident_id and reporter_id=(select auth.uid()) and submission_state='submitted' for update;
  if not found then raise exception 'Your report was not found'; end if;
  select * into c from public.nigraan_citizen_changes where id=change_id for update;
  if not found then raise exception 'Citizen draft no longer exists'; end if;
  if c.submission_state='published' then return c.incident_id; end if;
  if c.kind='edit' then
    if i.status<>'reported' then raise exception using errcode='PT409',message='This report is already being processed. The original report can no longer be edited. Add an update instead.'; end if;
    if i.updated_at is distinct from c.expected_updated_at then raise exception using errcode='PT409',message='This report changed. Refresh it before editing.'; end if;
    perform public.nigraan_validate_citizen_fields(c.proposed_fields);
    snapshot:=jsonb_build_object('title',i.title,'description',i.description,'category',i.category,'area',i.area,'latitude',i.latitude,'longitude',i.longitude,'location_accuracy',i.location_accuracy);
    proposed:=c.proposed_fields||jsonb_build_object('title',trim(c.proposed_fields->>'title'),'description',trim(c.proposed_fields->>'description'),'area',trim(c.proposed_fields->>'area'),'location_accuracy',c.proposed_fields->'location_accuracy');
    for key in select jsonb_object_keys(proposed) loop
      if snapshot->key is distinct from proposed->key then
        before_values:=before_values||jsonb_build_object(key,snapshot->key);after_values:=after_values||jsonb_build_object(key,proposed->key);
      end if;
    end loop;
  elsif i.status not in ('acknowledged','assigned','in_progress') then
    raise exception using errcode='PT409',message='This report is completed or no longer accepts updates. Refresh its status.';
  end if;
  if jsonb_typeof(attachments) is distinct from 'array' or jsonb_array_length(attachments)>2 then raise exception 'At most one photo and one recording are allowed'; end if;
  if c.kind='edit' and after_values='{}'::jsonb and jsonb_array_length(attachments)=0 then raise exception 'No report changes to save'; end if;
  for item in select value from jsonb_array_elements(attachments) loop
    path:=item->>'storage_path';
    if path is null or path=any(seen) or split_part(path,'/',2)<>c.incident_id::text or split_part(path,'/',3)<>change_id::text or not public.nigraan_storage_access(path,'write') then raise exception 'Invalid evidence ownership or duplicate path'; end if;
    seen:=array_append(seen,path);
    select metadata into meta from storage.objects where bucket_id='incident-evidence' and name=path;
    if not found then raise exception 'Evidence upload missing'; end if;
    mime:=lower(trim(split_part(meta->>'mimetype',';',1)));bytes:=(meta->>'size')::integer;
    if mime in ('image/jpeg','image/png','image/webp') and bytes between 1 and 5242880 and item->>'source' in ('camera','upload') then kind:='image';
    elsif mime in ('audio/webm','audio/ogg','audio/mp4') and bytes between 1 and 10485760 and item->>'source'='recording' then kind:='audio';
    else raise exception 'Invalid photo or voice upload'; end if;
    if exists(select 1 from public.evidence where citizen_change_id=change_id and media_type=kind) then raise exception 'Only one new file per evidence type is allowed'; end if;
    insert into public.evidence(incident_id,uploader_id,storage_path,media_type,mime_type,source,file_size,created_at,transcription_status,citizen_change_id)
      values(c.incident_id,(select auth.uid()),path,kind,mime,item->>'source',bytes,now(),case when kind='audio' and item->>'transcription_status'='failed' then 'failed' else 'not_connected' end,change_id)
      returning id into evidence_id;
    if item->>'transcription_job' is not null then
      if kind<>'audio' then raise exception 'Transcript requires audio'; end if;
      select * into job from public.nigraan_transcription_jobs where id=(item->>'transcription_job')::uuid and user_id=(select auth.uid()) for update;
      if not found or job.status<>'ready' or job.expires_at<=now() or job.bound_path is distinct from path or job.consumed_incident is not null then raise exception 'Transcript receipt is invalid or expired. Keep audio without transcript and retry.'; end if;
      corrected:=item->>'transcript';
      if corrected is null or char_length(trim(corrected))=0 or char_length(corrected)>12000 then raise exception 'Invalid transcript'; end if;
      reviewed:=coalesce((item->>'transcript_reviewed')::boolean,false) or corrected is distinct from job.machine_text;
      update public.evidence set transcript=corrected,machine_transcript=job.machine_text,transcription_status=case when reviewed then 'confirmed' else 'ready' end,
        transcription_provider=job.provider,transcription_model=job.model,selected_language=job.selected_language,detected_language=job.detected_language,
        transcribed_at=job.completed_at,transcript_reviewed_at=case when reviewed then now() else null end where id=evidence_id;
      update public.nigraan_transcription_jobs set consumed_incident=c.incident_id where id=job.id;
    end if;
  end loop;
  if c.kind='edit' then
    update public.incidents set title=proposed->>'title',description=proposed->>'description',category=proposed->>'category',area=proposed->>'area',
      latitude=(proposed->>'latitude')::double precision,longitude=(proposed->>'longitude')::double precision,location_accuracy=(proposed->>'location_accuracy')::double precision,updated_at=now() where id=i.id;
  else update public.incidents set updated_at=now() where id=i.id; end if;
  update public.nigraan_citizen_changes set submission_state='published',published_at=now(),original_snapshot=snapshot,
    previous_values=case when c.kind='edit' then before_values else null end,new_values=case when c.kind='edit' then after_values else null end,proposed_fields=null where id=change_id;
  return c.incident_id;
end;
$$;

create function public.nigraan_abandon_citizen_change(change_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.nigraan_citizen_changes;
begin
  select * into c from public.nigraan_citizen_changes where id=change_id and citizen_id=(select auth.uid()) for update;
  if not found then return; end if;
  if c.submission_state<>'draft' then raise exception 'Published activity cannot be removed'; end if;
  if exists(select 1 from storage.objects where bucket_id='incident-evidence' and split_part(name,'/',3)=change_id::text and split_part(name,'/',2)=c.incident_id::text) then raise exception 'Remove draft uploads first'; end if;
  delete from public.nigraan_citizen_changes where id=change_id;
end;
$$;
revoke all on function public.nigraan_begin_citizen_change(uuid,uuid,text,jsonb,text,timestamptz),public.nigraan_finalize_citizen_change(uuid,jsonb),public.nigraan_abandon_citizen_change(uuid) from public,anon,authenticated;
grant execute on function public.nigraan_begin_citizen_change(uuid,uuid,text,jsonb,text,timestamptz),public.nigraan_finalize_citizen_change(uuid,jsonb),public.nigraan_abandon_citizen_change(uuid) to authenticated;
commit;
