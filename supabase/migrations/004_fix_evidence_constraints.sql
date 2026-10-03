-- Existing project, after deployed 002 and 003. Run ONLY this new migration.
-- No evidence/incident/Storage rows are updated or deleted. RLS and bucket privacy
-- are unchanged. Legacy rows keep their original values; mime_type starts NULL.
begin;
set local lock_timeout = '10s';
lock table public.evidence in access exclusive mode;
alter table public.evidence add column if not exists mime_type text;

-- Read real installed definitions rather than assuming legacy allowed values.
-- Inspect EVERY evidence CHECK against the combinations the finalizer writes.
-- Reconcile conflicting rules confined to the canonical evidence fields; never
-- silently remove an unrelated/custom rule (e.g. an ownership/path invariant).
do $$
declare
  installed record; sample record; candidate jsonb; accepted boolean;
  conflicts boolean; canonical_columns smallint[]; transcription text; bytes integer;
begin
  select array_agg(attnum) into canonical_columns from pg_attribute
    where attrelid='public.evidence'::regclass and not attisdropped
      and attname in ('media_type','mime_type','source','file_size','transcription_status');
  for installed in
    select conname, conkey, pg_get_constraintdef(oid) as definition,
      pg_get_expr(conbin,conrelid) as expression
    from pg_constraint where conrelid='public.evidence'::regclass and contype='c'
  loop
    raise notice 'Installed evidence CHECK %: %', installed.conname, installed.definition;
    conflicts := false;
    for sample in select * from (values
      ('image','image/jpeg','camera','jpg',5242880),
      ('image','image/jpeg','upload','jpg',5242880),
      ('image','image/png','camera','png',5242880),
      ('image','image/png','upload','png',5242880),
      ('image','image/webp','camera','webp',5242880),
      ('image','image/webp','upload','webp',5242880),
      ('audio','audio/webm','recording','webm',10485760),
      ('audio','audio/ogg','recording','ogg',10485760),
      ('audio','audio/mp4','recording','m4a',10485760)
    ) as formats(kind,mime,origin,extension,max_bytes)
    loop
      foreach transcription in array array['not_connected','pending','ready','failed','confirmed'] loop
        foreach bytes in array array[1,sample.max_bytes] loop
          candidate := jsonb_build_object(
            'id','00000000-0000-4000-8000-000000000003',
            'incident_id','00000000-0000-4000-8000-000000000002',
            'uploader_id','00000000-0000-4000-8000-000000000001',
            'storage_path','00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003.' || sample.extension,
            'media_type',sample.kind,'mime_type',sample.mime,'source',sample.origin,
            'file_size',bytes,'created_at',now(),'transcription_status',transcription,
            'transcript',case when transcription in ('ready','confirmed') then 'Test transcript' else null end);
          execute format('select (%s) is not false from jsonb_populate_record(null::public.evidence,$1)',
            installed.expression) into accepted using candidate;
          if not accepted then
            conflicts := true;
            raise notice 'CHECK % rejects media_type=%, mime_type=%, source=%, file_size=%, transcription_status=%',
              installed.conname,sample.kind,sample.mime,sample.origin,bytes,transcription;
            exit;
          end if;
        end loop;
        exit when conflicts;
      end loop;
      exit when conflicts;
    end loop;
    if conflicts then
      if cardinality(installed.conkey)>0 and installed.conkey <@ canonical_columns then
        execute format('alter table public.evidence drop constraint %I',installed.conname);
      else
        raise exception 'Review unrelated/custom evidence CHECK % before applying 004: %',
          installed.conname,installed.definition;
      end if;
    end if;
  end loop;
end;
$$;

-- NOT VALID preserves every old row without guessing or backfilling its format.
-- These checks enforce the new contract for all subsequent inserts/updates.
alter table public.evidence drop constraint if exists nigraan_evidence_media_canonical_check;
alter table public.evidence add constraint nigraan_evidence_media_canonical_check
  check(media_type is not null and media_type in ('image','audio')) not valid;
alter table public.evidence drop constraint if exists nigraan_evidence_source_canonical_check;
alter table public.evidence add constraint nigraan_evidence_source_canonical_check
  check(source is not null and
    ((media_type='image' and source in ('camera','upload')) or
     (media_type='audio' and source='recording'))) not valid;
alter table public.evidence drop constraint if exists nigraan_evidence_mime_size_check;
alter table public.evidence add constraint nigraan_evidence_mime_size_check
  check(mime_type is not null and file_size is not null and
    ((media_type='image' and mime_type in ('image/jpeg','image/png','image/webp')
      and file_size between 1 and 5242880) or
     (media_type='audio' and mime_type in ('audio/webm','audio/ogg','audio/mp4')
      and file_size between 1 and 10485760))) not valid;
alter table public.evidence drop constraint if exists nigraan_evidence_transcription_canonical_check;
alter table public.evidence add constraint nigraan_evidence_transcription_canonical_check
  check(transcription_status is not null and transcription_status in
    ('not_connected','pending','ready','failed','confirmed')) not valid;

-- Replace the deployed RPC here, not in 002. MIME/kind/size are derived from
-- Storage metadata; browser-supplied media_type or mime_type cannot override them.
create or replace function public.nigraan_finalize_incident(incident uuid, attachments jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.incidents; item jsonb; object_meta jsonb; mime text; kind text; bytes integer;
  seen text[] := array[]::text[]; has_photo boolean := false; file_path text;
begin
  select * into i from public.incidents where id=incident and reporter_id=(select auth.uid()) for update;
  if not found then raise exception 'Incident not found'; end if;
  if not exists(select 1 from public.profiles where id=(select auth.uid()) and account_type='citizen')
    then raise exception 'Citizen account required'; end if;
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
revoke all on function public.nigraan_finalize_incident(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.nigraan_finalize_incident(uuid,jsonb) to authenticated;
commit;

-- Review all remaining CHECKs and legacy exceptions. Counts do not alter data.
select conname,pg_get_constraintdef(oid) as definition,convalidated
from pg_constraint where conrelid='public.evidence'::regclass and contype='c'
order by conname;
select count(*) as existing_evidence_rows,
  count(*) filter(where media_type is null or media_type not in ('image','audio')) as legacy_media_rows,
  count(*) filter(where mime_type is null) as rows_without_mime,
  count(*) filter(where source is null or source not in ('camera','upload','recording')) as legacy_source_rows
from public.evidence;
