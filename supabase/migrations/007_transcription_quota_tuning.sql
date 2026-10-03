-- Apply after 006. Existing jobs/provenance/RLS remain intact; no rows rewritten.
begin;
set local lock_timeout='10s';
alter table public.nigraan_transcription_jobs add column active_until timestamptz;
create or replace function public.nigraan_start_transcription(caller uuid,audio_hash text,language_choice text)
returns uuid language plpgsql security definer set search_path='' as $$
declare job uuid; short_count integer; daily_count integer; available_at timestamptz;
begin
  -- Serialize admission across tabs/devices/Edge instances for this identity.
  perform 1 from public.profiles where id=caller for update;
  if not found then raise exception 'Citizen account required'; end if;
  select max(coalesce(active_until,created_at+interval '2 minutes')) into available_at
    from public.nigraan_transcription_jobs where user_id=caller and status='pending'
      and coalesce(active_until,created_at+interval '2 minutes')>now();
  if available_at is not null then
    raise exception using errcode='PT409',message='A transcription is already processing.',
      detail=jsonb_build_object('code','transcription_busy','retry_after',greatest(1,ceil(extract(epoch from available_at-now()))))::text;
  end if;
  select count(*) into short_count from public.nigraan_transcription_jobs where user_id=caller and created_at>now()-interval '10 minutes';
  select count(*) into daily_count from public.nigraan_transcription_jobs where user_id=caller and created_at>now()-interval '24 hours';
  -- Daily takes precedence if both windows are exhausted.
  if daily_count>=100 then
    select created_at+interval '24 hours' into available_at from public.nigraan_transcription_jobs
      where user_id=caller and created_at>now()-interval '24 hours' order by created_at offset (daily_count-100) limit 1;
    raise exception using errcode='PT429',message='Transcription limit reached. Keep audio or retry later.',
      detail=jsonb_build_object('code','app_quota_daily','retry_after',greatest(1,ceil(extract(epoch from available_at-now()))))::text;
  end if;
  if short_count>=10 then
    select created_at+interval '10 minutes' into available_at from public.nigraan_transcription_jobs
      where user_id=caller and created_at>now()-interval '10 minutes' order by created_at offset (short_count-10) limit 1;
    raise exception using errcode='PT429',message='Transcription limit reached. Keep audio or retry later.',
      detail=jsonb_build_object('code','app_quota_short','retry_after',greatest(1,ceil(extract(epoch from available_at-now()))))::text;
  end if;
  insert into public.nigraan_transcription_jobs(user_id,audio_sha256,selected_language,active_until)
    values(caller,audio_hash,language_choice,now()+interval '2 minutes') returning id into job;
  return job;
end;
$$;
revoke all on function public.nigraan_start_transcription(uuid,text,text) from public,anon,authenticated;
grant execute on function public.nigraan_start_transcription(uuid,text,text) to service_role;
commit;
