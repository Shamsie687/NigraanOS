-- Future observations only: no historical incident/evidence rows are rewritten.
begin;
set local lock_timeout='10s';
create table public.nigraan_accountability_baseline (
  id integer primary key check(id=1), recording_started_at timestamptz not null
);
insert into public.nigraan_accountability_baseline values(1,clock_timestamp());
create table public.nigraan_incident_workflow_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents(id),
  kind text not null check(kind in ('publication','transition','assignment')),
  previous_status text,
  status text not null check(status in ('reported','acknowledged','assigned','in_progress','resolved')),
  actor_id uuid references public.profiles(id),
  recorded_at timestamptz not null default clock_timestamp()
);
create index nigraan_workflow_incident_time on public.nigraan_incident_workflow_events(incident_id,recorded_at,id);
create table public.nigraan_operations_public_updates (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.incidents(id),
  author_id uuid not null references public.operations_profiles(user_id),
  kind text not null check(kind in ('progress','resolution')),
  message text not null check(char_length(trim(message)) between 1 and 1000),
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(author_id,request_id)
);
create index nigraan_public_updates_incident_time on public.nigraan_operations_public_updates(incident_id,created_at,id);
alter table public.nigraan_accountability_baseline enable row level security;
alter table public.nigraan_incident_workflow_events enable row level security;
alter table public.nigraan_operations_public_updates enable row level security;
revoke all on public.nigraan_accountability_baseline,public.nigraan_incident_workflow_events,public.nigraan_operations_public_updates from public,anon,authenticated;
revoke all on sequence public.nigraan_incident_workflow_events_id_seq,public.nigraan_operations_public_updates_id_seq from public,anon,authenticated;

-- AFTER trigger is part of the same transaction, including finalizer rollback.
-- Combined status/assignment changes produce one event; edits produce none.
create function public.nigraan_record_workflow() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_kind text; actor uuid;
begin
  if new.submission_state<>'submitted' then return new; end if;
  if tg_op='INSERT' then event_kind:='publication';
  elsif old.submission_state is distinct from 'submitted' then event_kind:='publication';
  elsif new.status is distinct from old.status then event_kind:='transition';
  elsif new.assigned_organization_id is distinct from old.assigned_organization_id then event_kind:='assignment';
  else return new; end if;
  if new.status not in ('reported','acknowledged','assigned','in_progress','resolved') then return new; end if;
  actor:=case when event_kind<>'publication' and public.is_approved_operations() then auth.uid() else null end;
  insert into public.nigraan_incident_workflow_events(incident_id,kind,previous_status,status,actor_id)
    values(new.id,event_kind,case when tg_op='UPDATE' and event_kind<>'publication' then old.status else null end,new.status,actor);
  return new;
end;
$$;
revoke all on function public.nigraan_record_workflow() from public,anon,authenticated;
create trigger nigraan_workflow_after_change after insert or update on public.incidents
  for each row execute function public.nigraan_record_workflow();

-- Raw relations have no browser access. Both workspaces receive safe projections.
create function public.nigraan_read_accountability(incident uuid, event_before bigint default null, update_before bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.incidents; result jsonb; organization jsonb;
begin
  select * into i from public.incidents where id=incident and submission_state='submitted';
  if auth.uid() is null or not found or i.reporter_id is distinct from auth.uid() then
    raise exception using errcode='PT403',message='Your report is unavailable'; end if;
  select jsonb_build_object('name',o.organization_name,'type',o.organization_type) into organization
    from public.operations_profiles o join public.profiles p on p.id=o.user_id
    where o.user_id=i.assigned_organization_id and o.verification_status='approved';
  select jsonb_build_object('status',i.status,'reportedAt',i.reported_at,
    'recordingStartedAt',(select recording_started_at from public.nigraan_accountability_baseline where id=1),
    'legacyHistory',not exists(select 1 from public.nigraan_incident_workflow_events where incident_id=incident and kind='publication'),
    'organization',organization,
    'events',coalesce((select jsonb_agg(jsonb_build_object('cursor',e.id,'kind',e.kind,'status',e.status,'recordedAt',e.recorded_at) order by e.id desc)
      from (select * from public.nigraan_incident_workflow_events where incident_id=incident and (event_before is null or id<event_before) order by id desc limit 50)e),'[]'::jsonb),
    'updates',coalesce((select jsonb_agg(jsonb_build_object('cursor',u.id,'kind',u.kind,'message',u.message,'createdAt',u.created_at) order by u.id desc)
      from (select * from public.nigraan_operations_public_updates where incident_id=incident and (update_before is null or id<update_before) order by id desc limit 50)u),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.nigraan_update_incident_status(
  incident uuid, expected_status text, next_status text
) returns uuid language plpgsql security definer set search_path='' as $$
declare current_status text; allowed_next text;
begin
  if not public.is_approved_operations() then raise exception 'Approved Operations access required'; end if;
  if next_status='resolved' then raise exception using errcode='PT409',message='Resolution requires a Citizen-visible resolution message workflow'; end if;
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

-- Incident lock serializes workflow and retry admission.
create function public.nigraan_publish_public_update(incident uuid, body text, request_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare i public.incidents; existing public.nigraan_operations_public_updates; result bigint;
begin
  if auth.uid() is null or not public.is_approved_operations() then
    raise exception using errcode='PT403',message='Approved Operations access required'; end if;
  if body is null or char_length(trim(body)) not between 1 and 1000 or request_id is null then
    raise exception using errcode='PT400',message='Enter a Citizen-visible message up to 1000 characters'; end if;
  select * into i from public.incidents where id=incident and submission_state='submitted' for update;
  if not found or not public.is_approved_operations() then raise exception using errcode='PT403',message='Submitted incident unavailable'; end if;
  select * into existing from public.nigraan_operations_public_updates u where u.author_id=auth.uid() and u.request_id=nigraan_publish_public_update.request_id;
  if found then
    if existing.incident_id<>incident or existing.kind<>'progress' or existing.message<>trim(body) then raise exception 'Retry does not match original message'; end if;
    return existing.id;
  end if;
  if i.status not in ('acknowledged','assigned','in_progress') then raise exception using errcode='PT409',message='Progress updates require an active processing stage'; end if;
  insert into public.nigraan_operations_public_updates(incident_id,author_id,kind,message,request_id)
    values(incident,auth.uid(),'progress',trim(body),request_id) returning id into result;
  return result;
end;
$$;
create function public.nigraan_resolve_with_message(incident uuid, expected_status text, body text, request_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare i public.incidents; existing public.nigraan_operations_public_updates; result bigint;
begin
  if auth.uid() is null or not public.is_approved_operations() then raise exception using errcode='PT403',message='Approved Operations access required'; end if;
  if body is null or char_length(trim(body)) not between 1 and 1000 or request_id is null then raise exception using errcode='PT400',message='Enter a Citizen-visible resolution message up to 1000 characters'; end if;
  select * into i from public.incidents where id=incident and submission_state='submitted' for update;
  if not found or not public.is_approved_operations() then raise exception using errcode='PT403',message='Submitted incident unavailable'; end if;
  select * into existing from public.nigraan_operations_public_updates u where u.author_id=auth.uid() and u.request_id=nigraan_resolve_with_message.request_id;
  if found then
    if existing.incident_id<>incident or existing.kind<>'resolution' or existing.message<>trim(body) then raise exception 'Retry does not match original message'; end if;
    return existing.id;
  end if;
  if expected_status is distinct from 'in_progress' or i.status is distinct from expected_status then raise exception using errcode='PT409',message='Refresh the incident before resolving'; end if;
  update public.incidents set status='resolved',updated_at=now() where id=incident;
  insert into public.nigraan_operations_public_updates(incident_id,author_id,kind,message,request_id)
    values(incident,auth.uid(),'resolution',trim(body),request_id) returning id into result;
  return result;
end;
$$;
create function public.nigraan_read_operations_updates(incident uuid, before_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_approved_operations() or not exists(select 1 from public.incidents where id=incident and submission_state='submitted') then
    raise exception using errcode='PT403',message='Approved Operations access required'; end if;
  return jsonb_build_object(
    'events',coalesce((select jsonb_agg(jsonb_build_object('cursor',e.id,'kind',e.kind,'status',e.status,'recordedAt',e.recorded_at) order by e.id desc)
      from (select * from public.nigraan_incident_workflow_events where incident_id=incident order by id desc limit 50)e),'[]'::jsonb),
    'updates',coalesce((select jsonb_agg(jsonb_build_object('cursor',u.id,'kind',u.kind,'message',u.message,'createdAt',u.created_at) order by u.id desc)
      from (select * from public.nigraan_operations_public_updates where incident_id=incident and (before_id is null or id<before_id) order by id desc limit 50)u),'[]'::jsonb));
end;
$$;
revoke all on function public.nigraan_read_accountability(uuid,bigint,bigint),public.nigraan_publish_public_update(uuid,text,uuid),public.nigraan_resolve_with_message(uuid,text,text,uuid),public.nigraan_read_operations_updates(uuid,bigint) from public,anon,authenticated;
grant execute on function public.nigraan_read_accountability(uuid,bigint,bigint),public.nigraan_publish_public_update(uuid,text,uuid),public.nigraan_resolve_with_message(uuid,text,text,uuid),public.nigraan_read_operations_updates(uuid,bigint) to authenticated;
commit;
