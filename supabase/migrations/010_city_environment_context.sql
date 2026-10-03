-- Additive environmental cache only. Apply after 009; never rerun old migrations.
begin;
set local lock_timeout='10s';
create table public.city_environment_cache (
  city_id text not null check(city_id='karachi'),
  dataset text not null check(dataset in ('weather','air_quality')),
  normalization_version integer not null check(normalization_version=1),
  payload jsonb,
  fetched_at timestamptz,
  refresh_after timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  retry_after timestamptz,
  primary key(city_id,dataset,normalization_version)
);
alter table public.city_environment_cache enable row level security;
revoke all on public.city_environment_cache from public,anon,authenticated;
-- Service-only RPCs have fixed tables and arguments; no incident/evidence reads.
create function public.city_environment_claim(city_choice text,dataset_choice text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.city_environment_cache; t timestamptz:=clock_timestamp(); token uuid;
begin
  if city_choice<>'karachi' or dataset_choice not in ('weather','air_quality') then raise exception 'Unsupported context'; end if;
  insert into public.city_environment_cache(city_id,dataset,normalization_version) values(city_choice,dataset_choice,1) on conflict do nothing;
  select * into r from public.city_environment_cache where city_id=city_choice and dataset=dataset_choice and normalization_version=1 for update;
  if coalesce(r.refresh_after<=t,true) and coalesce(r.lease_until<=t,true) and coalesce(r.retry_after<=t,true) then
    token:=gen_random_uuid();
    update public.city_environment_cache set lease_token=token,lease_until=t+interval '30 seconds' where city_id=city_choice and dataset=dataset_choice and normalization_version=1;
  end if;
  return jsonb_build_object('payload',r.payload,'fetched_at',r.fetched_at,'refresh_after',r.refresh_after,'retry_after',r.retry_after,'lease',token);
end;
$$;
create function public.city_environment_finish(city_choice text,dataset_choice text,token_choice uuid,result_choice jsonb default null,retry_seconds integer default 60)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; t timestamptz:=clock_timestamp();
begin
  update public.city_environment_cache set
    payload=coalesce(result_choice,payload),
    fetched_at=case when result_choice is null then fetched_at else t end,
    refresh_after=case when result_choice is null then refresh_after else t+case when dataset='weather' then interval '15 minutes' else interval '60 minutes' end end,
    retry_after=case when result_choice is null then t+make_interval(secs=>greatest(30,least(86400,retry_seconds))) else null end,
    lease_token=null,lease_until=null
    where city_id=city_choice and dataset=dataset_choice and normalization_version=1 and lease_token=token_choice and lease_until>t;
  get diagnostics n=row_count;return n=1;
end;
$$;
revoke all on function public.city_environment_claim(text,text),public.city_environment_finish(text,text,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.city_environment_claim(text,text),public.city_environment_finish(text,text,uuid,jsonb,integer) to service_role;
commit;
