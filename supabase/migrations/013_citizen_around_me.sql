-- One-time additive migration. No canonical incidents/evidence are rewritten.
begin;
set local lock_timeout='10s';

create table public.nigraan_around_me_releases (
  snapshot_day date primary key,
  window_days integer not null default 30 check(window_days=30),
  state text not null check(state in ('building','published')),
  built_at timestamptz not null default clock_timestamp()
);
create table public.nigraan_around_me_groups (
  snapshot_day date not null references public.nigraan_around_me_releases(snapshot_day),
  cell_row integer not null check(cell_row>=0),
  cell_column integer not null check(cell_column>=0),
  category text not null check(category in ('traffic','flood','garbage','air_quality','water','power','road_damage','other')),
  public_state text not null check(public_state in ('reported','acknowledged','processing','resolved')),
  count_band text not null check(count_band in ('5–9','10–19','20–49','50+')),
  primary key(snapshot_day,cell_row,cell_column,category,public_state)
);
create table public.nigraan_around_me_rate (
  account_id uuid primary key references public.profiles(id),
  attempts timestamptz[] not null default '{}' check(cardinality(attempts)<=100)
);
alter table public.nigraan_around_me_releases enable row level security;
alter table public.nigraan_around_me_groups enable row level security;
alter table public.nigraan_around_me_rate enable row level security;
revoke all on public.nigraan_around_me_releases,public.nigraan_around_me_groups,public.nigraan_around_me_rate from public,anon,authenticated;

-- One private, versioned source of database coverage configuration.
-- Order: south, north, west, east, angular cell step. Change through a future migration.
create function public.nigraan_around_me_config()
returns numeric[] language sql immutable set search_path='' as $$
  select array[24.70,25.30,66.80,67.60,0.02]::numeric[];
$$;
-- Fixed application coverage, not a municipal boundary: [24.70,25.30) x [66.80,67.60).
-- Numeric arithmetic avoids floating-point surprises at fixed cell edges.
create function public.nigraan_around_me_grid(lat double precision,lng double precision)
returns integer[] language plpgsql immutable set search_path='' as $$
declare cfg numeric[]:=public.nigraan_around_me_config();
begin
  if lat is null or lng is null or not (lat>=cfg[1] and lat<cfg[2] and lng>=cfg[3] and lng<cfg[4]) then
    raise exception using errcode='PT400',message='Location is outside Around Me coverage';
  end if;
  return array[floor((lat::numeric-cfg[1])/cfg[5])::integer,floor((lng::numeric-cfg[3])/cfg[5])::integer];
end;
$$;
create function public.nigraan_around_me_state(status_choice text)
returns text language sql immutable set search_path='' as $$
  select case status_choice when 'reported' then 'reported' when 'acknowledged' then 'acknowledged'
    when 'assigned' then 'processing' when 'in_progress' then 'processing' when 'resolved' then 'resolved' end;
$$;
create function public.nigraan_around_me_build()
returns date language plpgsql security definer set search_path='' as $$
declare day_choice date := (statement_timestamp() at time zone 'Asia/Karachi')::date;
  cutoff timestamptz := day_choice::timestamp at time zone 'Asia/Karachi';
  cfg numeric[]:=public.nigraan_around_me_config();
begin
  if exists(select 1 from public.nigraan_around_me_releases where snapshot_day=day_choice and state='published') then return day_choice; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(603013) then
    raise exception using errcode='PT503',message='Around Me snapshot is being prepared. Retry shortly';
  end if;
  if exists(select 1 from public.nigraan_around_me_releases where snapshot_day=day_choice and state='published') then return day_choice; end if;
  insert into public.nigraan_around_me_releases(snapshot_day,state) values(day_choice,'building');
  insert into public.nigraan_around_me_groups(snapshot_day,cell_row,cell_column,category,public_state,count_band)
    select day_choice,floor((i.latitude::numeric-cfg[1])/cfg[5])::integer,
      floor((i.longitude::numeric-cfg[3])/cfg[5])::integer,i.category,public.nigraan_around_me_state(i.status),
      case when count(*)<10 then '5–9' when count(*)<20 then '10–19' when count(*)<50 then '20–49' else '50+' end
    from public.incidents i
    where i.submission_state='submitted' and i.reporter_id is not null
      and i.reported_at>=cutoff-interval '30 days' and i.reported_at<cutoff
      and i.latitude>=cfg[1] and i.latitude<cfg[2] and i.longitude>=cfg[3] and i.longitude<cfg[4]
      and i.category in ('traffic','flood','garbage','air_quality','water','power','road_damage','other')
      and public.nigraan_around_me_state(i.status) is not null
    group by 2,3,4,5 having count(distinct i.reporter_id)>=5;
  update public.nigraan_around_me_releases set state='published' where snapshot_day=day_choice;
  -- Only this new aggregate cache is pruned; canonical data is never touched.
  delete from public.nigraan_around_me_groups where snapshot_day<day_choice-7;
  delete from public.nigraan_around_me_releases where snapshot_day<day_choice-7;
  return day_choice;
end;
$$;

-- Query protocol accepts cell indices only, never a precise viewing location.
create function public.nigraan_around_me(cell_row integer,cell_column integer)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='8s' as $$
declare caller uuid:=auth.uid(); recent timestamptz[]; at_time timestamptz:=clock_timestamp();
  day_choice date; minute_count integer; result jsonb; cfg numeric[]:=public.nigraan_around_me_config();
begin
  if caller is null or not exists(select 1 from public.profiles where id=caller) then
    raise exception using errcode='PT403',message='Sign in to view Around Me'; end if;
  if cell_row is null or cell_column is null or cell_row<0 or cell_column<0 or cell_row>=ceil((cfg[2]-cfg[1])/cfg[5]) or cell_column>=ceil((cfg[4]-cfg[3])/cfg[5]) then
    raise exception using errcode='PT400',message='Choose a location inside Around Me coverage'; end if;
  insert into public.nigraan_around_me_rate(account_id) values(caller) on conflict do nothing;
  select attempts into recent from public.nigraan_around_me_rate where account_id=caller for update;
  at_time:=clock_timestamp();
  select coalesce(array_agg(t order by t),'{}'::timestamptz[]),count(*) filter(where t>at_time-interval '1 minute')
    into recent,minute_count from unnest(recent) t where t>at_time-interval '24 hours';
  if cardinality(recent)>=100 then raise exception using errcode='PT429',message='Around Me daily limit reached. Retry later'; end if;
  if minute_count>=6 then raise exception using errcode='PT429',message='Around Me request limit reached. Wait a minute before retrying'; end if;
  update public.nigraan_around_me_rate set attempts=array_append(recent,at_time) where account_id=caller;
  day_choice:=public.nigraan_around_me_build();
  select jsonb_build_object('snapshotDay',day_choice,'reportingWindowDays',30,'cells',coalesce(jsonb_agg(c.cell order by c.r,c.col),'[]'::jsonb))
    into result from (
      select g.cell_row r,g.cell_column col,jsonb_build_object(
        'cellId','K-'||g.cell_row||'-'||g.cell_column,
        'generalizedBounds',jsonb_build_array(jsonb_build_array(cfg[1]+g.cell_row*cfg[5],cfg[3]+g.cell_column*cfg[5]),jsonb_build_array(cfg[1]+(g.cell_row+1)*cfg[5],cfg[3]+(g.cell_column+1)*cfg[5])),
        'generalizedCenter',jsonb_build_array(cfg[1]+(g.cell_row+0.5)*cfg[5],cfg[3]+(g.cell_column+0.5)*cfg[5]),
        'groups',jsonb_agg(jsonb_build_object('category',g.category,'publicWorkflowState',g.public_state,'reportCountBand',g.count_band) order by g.category,g.public_state)) cell
      from public.nigraan_around_me_groups g
      where g.snapshot_day=day_choice and exists(select 1 from public.nigraan_around_me_releases where snapshot_day=day_choice and state='published')
        and g.cell_row between nigraan_around_me.cell_row-1 and nigraan_around_me.cell_row+1
        and g.cell_column between nigraan_around_me.cell_column-1 and nigraan_around_me.cell_column+1
      group by g.cell_row,g.cell_column
    ) c;
  return result;
end;
$$;
revoke all on function public.nigraan_around_me_config(),public.nigraan_around_me_grid(double precision,double precision),public.nigraan_around_me_state(text),public.nigraan_around_me_build(),public.nigraan_around_me(integer,integer) from public,anon,authenticated;
grant execute on function public.nigraan_around_me(integer,integer) to authenticated;
commit;
