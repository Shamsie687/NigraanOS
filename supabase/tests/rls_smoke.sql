-- Optional: run as project owner AFTER 002, ideally in a staging project.
-- Synthetic storage metadata tests SQL policies/finalization, not actual media
-- uploads or file bytes. Everything is rolled back, including fixture users.
begin;
insert into auth.users(id,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','{"display_name":"RLS Citizen A","full_name":"RLS Citizen A","account_type":"citizen"}'),
('00000000-0000-4000-8000-000000000002','{"display_name":"RLS Citizen B","full_name":"RLS Citizen B","account_type":"citizen"}'),
('00000000-0000-4000-8000-000000000003','{"display_name":"RLS Pending","full_name":"RLS Pending","account_type":"operations","organization_name":"Test NGO","organization_type":"ngo","verification_status":"approved"}'),
('00000000-0000-4000-8000-000000000004','{"display_name":"RLS Approved","full_name":"RLS Approved","account_type":"operations","organization_name":"Test Utility","organization_type":"utility"}');
set constraints all immediate;
do $$ begin
  if (select verification_status from public.operations_profiles where user_id='00000000-0000-4000-8000-000000000003')<>'pending'
    then raise exception 'Metadata incorrectly granted approval'; end if;
end $$;
update public.operations_profiles set verification_status='approved'
where user_id='00000000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.nigraan_begin_incident('00000000-0000-4000-8000-000000000005','RLS test','Test description','water','Test area',24.8,67,10);
do $$ begin
  begin
    perform public.nigraan_finalize_incident('00000000-0000-4000-8000-000000000005','[]');
    raise exception 'Finalized without photo' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    update public.incidents set priority='critical' where id='00000000-0000-4000-8000-000000000005';
    raise exception 'Citizen changed priority' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set account_type='operations' where id=auth.uid();
    raise exception 'Citizen changed account type' using errcode='XX000';
  exception when insufficient_privilege then null; end;
end $$;

-- Storage policy allows only this user's own draft path.
insert into storage.objects(bucket_id,name,metadata) values
('incident-evidence','00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/voice.webm','{"mimetype":"audio/webm","size":100}');
do $$ begin
  begin
    perform public.nigraan_finalize_incident('00000000-0000-4000-8000-000000000005',
      '[{"storage_path":"00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/voice.webm","source":"recording"}]');
    raise exception 'Finalized voice-only incident' using errcode='XX000';
  exception when raise_exception then null; end;
  if exists(select 1 from public.evidence where incident_id='00000000-0000-4000-8000-000000000005')
    then raise exception 'Failed finalization left evidence records'; end if;
end $$;
-- Remove unassociated synthetic test metadata while draft cleanup is allowed.
delete from storage.objects where bucket_id='incident-evidence'
and name='00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/voice.webm';
insert into storage.objects(bucket_id,name,metadata) values
('incident-evidence','00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/photo.jpg','{"mimetype":"image/jpeg","size":100}');
select public.nigraan_finalize_incident('00000000-0000-4000-8000-000000000005',
'[{"storage_path":"00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/photo.jpg","source":"upload"}]');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$ begin
  if exists(select 1 from public.incidents where id='00000000-0000-4000-8000-000000000005')
    or exists(select 1 from public.evidence where incident_id='00000000-0000-4000-8000-000000000005')
    then raise exception 'Cross-citizen incident/evidence read allowed'; end if;
  if public.nigraan_storage_access('00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/photo.jpg','read')
    then raise exception 'Cross-citizen storage read allowed'; end if;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$ begin
  if exists(select 1 from public.incidents where id='00000000-0000-4000-8000-000000000005')
    then raise exception 'Pending Operations read city incidents'; end if;
  begin
    update public.operations_profiles set verification_status='approved' where user_id=auth.uid();
    raise exception 'Operations self-approved' using errcode='XX000';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
do $$ begin
  if not exists(select 1 from public.incidents where id='00000000-0000-4000-8000-000000000005')
    or not exists(select 1 from public.evidence where incident_id='00000000-0000-4000-8000-000000000005')
    then raise exception 'Approved Operations cannot read submitted incident/evidence'; end if;
  if not public.nigraan_storage_access('00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005/photo.jpg','read')
    then raise exception 'Approved Operations cannot read evidence storage'; end if;
end $$;
reset role;
update public.operations_profiles set verification_status='rejected'
where user_id='00000000-0000-4000-8000-000000000004';
set local role authenticated;
do $$ begin
  if exists(select 1 from public.incidents where id='00000000-0000-4000-8000-000000000005')
    then raise exception 'Revoked Operations still reads incidents'; end if;
end $$;
reset role;
rollback;
