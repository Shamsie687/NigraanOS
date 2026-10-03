-- Apply once AFTER deployed 005. No old migrations or existing rows are rewritten.
begin;
set local lock_timeout = '10s';
alter table public.evidence
  add column machine_transcript text,
  add column transcription_provider text,
  add column transcription_model text,
  add column selected_language text,
  add column detected_language text,
  add column transcribed_at timestamptz,
  add column transcript_reviewed_at timestamptz;

-- Private receipts: only the trusted Edge Function can create provider results.
-- Never grant browser reads/writes, even to approved Operations users.
create table public.nigraan_transcription_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  audio_sha256 text not null check(audio_sha256 ~ '^[0-9a-f]{64}$'),
  selected_language text not null check(selected_language in ('auto','ur','en')),
  detected_language text,
  status text not null default 'pending' check(status in ('pending','ready','failed')),
  machine_text text check(char_length(machine_text) between 1 and 12000),
  provider text not null default 'groq' check(provider='groq'),
  model text not null default 'whisper-large-v3' check(model='whisper-large-v3'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now()+interval '24 hours',
  bound_path text,
  consumed_incident uuid references public.incidents(id),
  check(status<>'ready' or (machine_text is not null and completed_at is not null))
);
create index nigraan_transcription_jobs_user_time on public.nigraan_transcription_jobs(user_id,created_at);
alter table public.nigraan_transcription_jobs enable row level security;
revoke all on public.nigraan_transcription_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.nigraan_transcription_jobs to service_role;

-- Concurrency-safe per-user budget, including failed attempts. No provider key here.
create function public.nigraan_start_transcription(caller uuid, audio_hash text, language_choice text)
returns uuid language plpgsql security definer set search_path='' as $$
declare job uuid;
begin
  perform 1 from public.profiles where id=caller for update;
  if not found then raise exception 'Citizen account required'; end if;
  if (select count(*) from public.nigraan_transcription_jobs where user_id=caller and created_at>now()-interval '10 minutes')>=5
    or (select count(*) from public.nigraan_transcription_jobs where user_id=caller and created_at>now()-interval '24 hours')>=30
    then raise exception 'Transcription limit reached. Keep audio or retry later.'; end if;
  insert into public.nigraan_transcription_jobs(user_id,audio_sha256,selected_language)
    values(caller,audio_hash,language_choice) returning id into job;
  return job;
end;
$$;
revoke all on function public.nigraan_start_transcription(uuid,text,text) from public,anon,authenticated;
grant execute on function public.nigraan_start_transcription(uuid,text,text) to service_role;

-- Retain deployed 005 validation verbatim as a private implementation. The public
-- wrapper adds atomic transcription attachment, retaining required photo + audio.
alter function public.nigraan_finalize_incident(uuid,jsonb) rename to nigraan_finalize_incident_base_v5;
revoke all on function public.nigraan_finalize_incident_base_v5(uuid,jsonb) from public,anon,authenticated;
create function public.nigraan_finalize_incident(incident uuid, attachments jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.incidents; item jsonb; job public.nigraan_transcription_jobs;
  file public.evidence; corrected text; reviewed boolean;
begin
  select * into i from public.incidents where id=incident and reporter_id=(select auth.uid()) for update;
  if not found then raise exception 'Incident not found'; end if;
  -- Preserve lost-response idempotency; submitted evidence is never rewritten.
  if i.submission_state='submitted' then return incident; end if;
  perform public.nigraan_finalize_incident_base_v5(incident,attachments);
  for item in select value from jsonb_array_elements(attachments) loop
    select * into file from public.evidence where incident_id=incident and storage_path=item->>'storage_path';
    if item->>'transcription_job' is not null then
      if file.media_type is distinct from 'audio' then raise exception 'Transcript requires audio evidence'; end if;
      select * into job from public.nigraan_transcription_jobs
        where id=(item->>'transcription_job')::uuid and user_id=(select auth.uid()) for update;
      if not found or job.status<>'ready' or job.expires_at<=now() or job.bound_path is distinct from file.storage_path
        or job.consumed_incident is not null then raise exception 'Transcript receipt is invalid or expired. Keep audio without transcript and retry.'; end if;
      corrected:=item->>'transcript';
      if corrected is null or char_length(trim(corrected))=0 or char_length(corrected)>12000 then raise exception 'Invalid transcript text'; end if;
      reviewed:=coalesce((item->>'transcript_reviewed')::boolean,false) or corrected is distinct from job.machine_text;
      update public.evidence set transcript=corrected,machine_transcript=job.machine_text,
        transcription_status=case when reviewed then 'confirmed' else 'ready' end,
        transcription_provider=job.provider,transcription_model=job.model,
        selected_language=job.selected_language,detected_language=job.detected_language,
        transcribed_at=job.completed_at,transcript_reviewed_at=case when reviewed then now() else null end
        where id=file.id;
      update public.nigraan_transcription_jobs set consumed_incident=incident where id=job.id;
    elsif file.media_type='audio' and item->>'transcription_status'='failed' then
      update public.evidence set transcription_status='failed' where id=file.id;
    end if;
  end loop;
  return incident;
end;
$$;
revoke all on function public.nigraan_finalize_incident(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.nigraan_finalize_incident(uuid,jsonb) to authenticated;
commit;
