-- Apply once after 008. Additive, read-only incident access; no existing rows changed.
begin;
set local lock_timeout='10s';

create table public.nigraan_ai_budget_lock (id integer primary key check(id=1));
insert into public.nigraan_ai_budget_lock values(1);
create table public.nigraan_ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  active_until timestamptz not null
);
create index nigraan_ai_requests_user_time on public.nigraan_ai_requests(user_id,created_at);
create index nigraan_ai_requests_time on public.nigraan_ai_requests(created_at);
alter table public.nigraan_ai_requests enable row level security;
alter table public.nigraan_ai_budget_lock enable row level security;
revoke all on public.nigraan_ai_requests,public.nigraan_ai_budget_lock from public,anon,authenticated;

-- No caller ID, timestamps, budget or model supplied by the client.
-- Fixed 60-second lease also provides a cooldown after completion. There is no
-- browser-callable early-release path that could defeat concurrent admission.
create function public.nigraan_ai_admit()
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); t timestamptz; available timestamptz;
  n integer; window_size interval; maximum integer; budget_code text; shared boolean;
begin
  if actor is null or not public.is_approved_operations() then
    raise exception using errcode='PT403',message='Approved Operations access required';
  end if;
  -- One mutex serializes both per-account and shared admission across instances.
  perform 1 from public.nigraan_ai_budget_lock where id=1 for update;
  t := clock_timestamp();
  -- Approval may have changed while this request waited for the mutex.
  if not public.is_approved_operations() then
    raise exception using errcode='PT403',message='Approved Operations access required';
  end if;
  select max(active_until) into available from public.nigraan_ai_requests
    where user_id=actor and active_until>t;
  if available is not null then
    raise exception using errcode='PT409',message='AI request active or cooling down',
      detail=jsonb_build_object('code','ai_busy','retryAfter',greatest(1,ceil(extract(epoch from available-t))))::text;
  end if;
  for window_size,maximum,budget_code,shared in values
    (interval '24 hours',50,'app_quota_daily',false),
    (interval '10 minutes',10,'app_quota_short',false),
    (interval '24 hours',40,'shared_quota_daily',true),
    (interval '60 seconds',1,'shared_quota_short',true)
  loop
    select count(*) into n from public.nigraan_ai_requests
      where created_at>t-window_size and (shared or user_id=actor);
    if n>=maximum then
      select created_at+window_size into available from public.nigraan_ai_requests
        where created_at>t-window_size and (shared or user_id=actor)
        order by created_at,id offset (n-maximum) limit 1;
      raise exception using errcode='PT429',message='AI request budget reached',
        detail=jsonb_build_object('code',budget_code,'retryAfter',greatest(1,ceil(extract(epoch from available-t))))::text;
    end if;
  end loop;
  insert into public.nigraan_ai_requests(user_id,created_at,active_until)
    values(actor,t,t+interval '60 seconds') returning id into actor;
  return actor;
end;
$$;

create function public.nigraan_ai_snapshot(
  scope_choice text default 'briefing', category_choice text default 'all',
  activity_hours integer default 24, selected_incident uuid default null
)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_approved_operations() then
    raise exception using errcode='PT403',message='Approved Operations access required';
  end if;
  if scope_choice is null or scope_choice not in ('briefing','unresolved','recent','longest','incident')
    or category_choice is null or category_choice not in ('all','traffic','flood','garbage','air_quality','water','power','road_damage','other')
    or activity_hours is null or activity_hours not in (24,168,720)
    or (scope_choice='incident') <> (selected_incident is not null) then
    raise exception using errcode='PT400',message='Unsupported AI scope';
  end if;
  -- A single statement supplies counts and bounded details from one MVCC snapshot.
  -- All relations here remain subject to the authenticated caller's RLS.
  with at_time as (select statement_timestamp() as t),
  visible as materialized (
    select i.id,left(i.title,200) as title,i.category,i.status,i.priority,i.reported_at,i.updated_at,
      case when i.reported_at is null then null else
        greatest(0,floor(extract(epoch from ((select t from at_time)-i.reported_at))))::bigint end as age_seconds
    from public.incidents i
    where i.submission_state='submitted'
      and (category_choice='all' or i.category=category_choice)
      and (selected_incident is null or i.id=selected_incident)
      and (scope_choice not in ('unresolved','longest') or i.status<>'resolved')
      and (scope_choice<>'recent' or exists(select 1 from public.nigraan_citizen_changes c
        where c.incident_id=i.id and c.submission_state='published'
          and c.published_at>=(select t from at_time)-make_interval(hours=>activity_hours)))
  ),
  activity as materialized (
    select c.id,c.incident_id,c.kind,c.published_at,
      array(select k from jsonb_object_keys(coalesce(c.new_values,'{}'::jsonb)) k
        where k in ('title','description','category','area','latitude','longitude','location_accuracy') order by k) as changed_fields
    from public.nigraan_citizen_changes c join visible i on i.id=c.incident_id
    where c.submission_state='published' and c.published_at>=(select t from at_time)-make_interval(hours=>activity_hours)
  ),
  supporting as materialized (
    select i.* from visible i order by
      case when scope_choice='recent' then (select max(published_at) from activity a where a.incident_id=i.id) end desc nulls last,
      case when scope_choice='unresolved' then case i.priority when 'critical' then 5 when 'high' then 4 when 'medium' then 3 when 'normal' then 2 when 'low' then 1 else 0 end end desc nulls last,
      case when scope_choice in ('longest','unresolved') then i.reported_at end asc nulls last,
      i.reported_at desc,i.id limit 8
  ),
  recent_details as (
    select a.* from activity a join supporting i on i.id=a.incident_id order by a.published_at desc,a.id limit 8
  )
  select jsonb_build_object(
    'snapshotAt',(select t from at_time),
    'scope',jsonb_build_object('mode',scope_choice,'category',category_choice,'activityHours',activity_hours),
    'facts',jsonb_build_object(
      'matchingCount',(select count(*) from visible),
      'unresolvedCount',(select count(*) from visible where status<>'resolved'),
      'oldestUnresolvedSeconds',(select max(age_seconds) from visible where status<>'resolved'),
      'recentUpdateCount',(select count(*) from activity where kind='update'),
      'recentEditCount',(select count(*) from activity where kind='edit'),
      'categories',coalesce((select jsonb_object_agg(category,n) from (select category,count(*) n from visible group by category) x),'{}'::jsonb),
      'statuses',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from visible group by status) x),'{}'::jsonb)),
    'incidents',coalesce((select jsonb_agg(to_jsonb(s)) from supporting s),'[]'::jsonb),
    'activity',coalesce((select jsonb_agg(to_jsonb(a)) from recent_details a),'[]'::jsonb),
    'includedCount',(select count(*) from supporting),
    'omittedCount',(select count(*) from visible)-(select count(*) from supporting),
    'includedActivityCount',(select count(*) from recent_details),
    'omittedActivityCount',(select count(*) from activity)-(select count(*) from recent_details)
  ) into result;
  if selected_incident is not null and (result->'facts'->>'matchingCount')::integer=0 then
    raise exception using errcode='PT404',message='Incident not available';
  end if;
  return result;
end;
$$;
revoke all on function public.nigraan_ai_admit(),public.nigraan_ai_snapshot(text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.nigraan_ai_admit(),public.nigraan_ai_snapshot(text,text,integer,uuid) to authenticated;
commit;
