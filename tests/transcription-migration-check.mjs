// Isolated PostgreSQL fixture; no deployed database or credentials are used.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../review/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const citizen='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; grant usage on schema auth,storage to anon,authenticated;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key references auth.users(id),display_name text not null,email text,phone text,avatar_url text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.incidents(id uuid primary key default gen_random_uuid(),reporter_id uuid not null references profiles(id),title text not null,description text not null,category text not null,status text not null default 'reported',latitude double precision not null,longitude double precision not null,location_accuracy double precision,reported_at timestamptz default now(),updated_at timestamptz default now());
    create table public.evidence(id uuid primary key default gen_random_uuid(),incident_id uuid not null references incidents(id),uploader_id uuid not null references profiles(id),storage_path text not null,media_type text not null,source text not null,file_size integer not null,created_at timestamptz default now());
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;
    insert into auth.users(id) values('${citizen}'),('${other}');insert into profiles(id,display_name) values('${citizen}','Citizen'),('${other}','Other');`);
  for(const file of ['002_accounts_evidence_upgrade.sql','003_fix_incident_categories.sql','004_fix_evidence_constraints.sql','005_multi_workspace_access.sql'])await db.exec(await sql(file));
  const login=async user=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');};
  const owner=()=>db.exec('reset role');
  const begin=async()=>{const id=crypto.randomUUID();await db.query("select public.nigraan_begin_incident($1,'Title','Description','water','Area',24.8,67,10)",[id]);return id;};
  const upload=async(id,mime)=>{const path=citizen+'/'+id+'/'+crypto.randomUUID()+'.'+(mime==='image/jpeg'?'jpg':'webm');await db.query("insert into storage.objects(bucket_id,name,metadata) values('incident-evidence',$1,$2)",[path,JSON.stringify({mimetype:mime,size:100})]);return {storage_path:path,source:mime==='image/jpeg'?'upload':'recording'};};
  const finalize=(id,files)=>db.query('select public.nigraan_finalize_incident($1,$2)',[id,JSON.stringify(files)]);
  await login(citizen);const original=await begin();const oldPhoto=await upload(original,'image/jpeg');await finalize(original,[oldPhoto]);await owner();
  const oldRows=(await db.query('select * from evidence')).rows;
  const policies=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  await db.exec(await sql('006_voice_transcription.sql'));
  assert.deepEqual((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,policies);
  const columns=['machine_transcript','transcription_provider','transcription_model','selected_language','detected_language','transcribed_at','transcript_reviewed_at'];
  assert.deepEqual((await db.query('select * from evidence')).rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!columns.includes(key)))),oldRows);
  assert.equal((await db.query("select public from storage.buckets where id='incident-evidence'")).rows[0].public,false);
  await login(citizen);
  await assert.rejects(()=>db.query('select * from nigraan_transcription_jobs'),/permission denied/);
  await assert.rejects(()=>db.query("select public.nigraan_start_transcription($1,$2,'ur')",[citizen,'0'.repeat(64)]),/permission denied/);
  await assert.rejects(()=>db.query('select public.nigraan_finalize_incident_base_v5($1,$2)',[original,'[]']),/permission denied/);
  // Audio-only and photo-only retain the established workflow.
  for(const status of [null,'failed']){const id=await begin();const photo=await upload(id,'image/jpeg');const voice=await upload(id,'audio/webm');if(status)voice.transcription_status=status;await finalize(id,[photo,voice]);assert.equal((await db.query("select transcription_status from evidence where incident_id=$1 and media_type='audio'",[id])).rows[0].transcription_status,status||'not_connected');}
  const id=await begin();const photo=await upload(id,'image/jpeg');const voice=await upload(id,'audio/webm');
  await owner();await db.exec('set role service_role');const job=(await db.query("select public.nigraan_start_transcription($1,$2,'ur')",[citizen,'a'.repeat(64)])).rows[0].nigraan_start_transcription;
  const machine='یہاں پانی کھڑا ہے۔';const corrected='گلی نمبر ۲ میں پانی کھڑا ہے۔';
  await db.query("update nigraan_transcription_jobs set status='ready',machine_text=$1,detected_language='urdu',completed_at=now(),bound_path=$2 where id=$3",[machine,voice.storage_path,job]);
  voice.transcription_job=job;voice.transcript=corrected;voice.transcript_reviewed=false;
  await db.query("update nigraan_transcription_jobs set expires_at=now()-interval '1 minute' where id=$1",[job]);
  await login(citizen);await assert.rejects(()=>finalize(id,[photo,voice]),/invalid or expired/);
  await owner();await db.query("update nigraan_transcription_jobs set expires_at=now()+interval '1 hour',bound_path='wrong/path' where id=$1",[job]);
  await login(citizen);await assert.rejects(()=>finalize(id,[photo,voice]),/invalid or expired/);
  await owner();await db.query('update nigraan_transcription_jobs set bound_path=$1,user_id=$2 where id=$3',[voice.storage_path,other,job]);
  await login(citizen);await assert.rejects(()=>finalize(id,[photo,voice]),/invalid or expired/);
  await owner();await db.query('update nigraan_transcription_jobs set user_id=$1 where id=$2',[citizen,job]);
  await login(other);await assert.rejects(()=>finalize(id,[photo,voice]),/Incident not found/);
  await login(citizen);await assert.rejects(()=>finalize(id,[photo,{...voice,transcription_job:crypto.randomUUID()}]),/invalid or expired/);
  assert.equal((await db.query('select submission_state from incidents where id=$1',[id])).rows[0].submission_state,'draft');
  assert.equal((await db.query('select count(*)::int as n from evidence where incident_id=$1',[id])).rows[0].n,0);
  await finalize(id,[photo,voice]);
  const row=(await db.query("select * from evidence where incident_id=$1 and media_type='audio'",[id])).rows[0];
  assert.equal(row.transcript,corrected);assert.equal(row.machine_transcript,machine);assert.equal(row.transcription_status,'confirmed');assert.ok(row.transcript_reviewed_at);
  // Lost-response retry cannot replace an already submitted transcript.
  await finalize(id,[photo,{...voice,transcript:'forged retry'}]);assert.equal((await db.query('select transcript from evidence where id=$1',[row.id])).rows[0].transcript,corrected);
  await assert.rejects(()=>db.query('update evidence set transcript=$1 where id=$2',['forged',row.id]),/permission denied/);
  const reused=await begin();const p=await upload(reused,'image/jpeg');const a=await upload(reused,'audio/webm');
  await assert.rejects(()=>finalize(reused,[p,{...a,transcription_job:job,transcript:machine}]),/invalid or expired/);
  await assert.rejects(()=>finalize(reused,[{...p,transcription_job:job,transcript:machine}]),/requires audio/);
  await assert.rejects(()=>finalize(reused,[a]),/photo is required/);
  // An unedited result is machine-only, not citizen-reviewed.
  await owner();const cleanJob=crypto.randomUUID();
  await db.query("insert into nigraan_transcription_jobs(id,user_id,audio_sha256,selected_language,status,machine_text,completed_at,bound_path) values($1,$2,$3,'auto','ready',$4,now(),$5)",[cleanJob,citizen,'c'.repeat(64),machine,a.storage_path]);
  await login(citizen);await finalize(reused,[p,{...a,transcription_job:cleanJob,transcript:machine,transcript_reviewed:false}]);
  const untouched=(await db.query("select transcription_status,transcript_reviewed_at from evidence where incident_id=$1 and media_type='audio'",[reused])).rows[0];
  assert.equal(untouched.transcription_status,'ready');assert.equal(untouched.transcript_reviewed_at,null);
  await login(other);assert.equal((await db.query('select * from evidence where incident_id=$1',[id])).rows.length,0);
  await owner();
  await db.query("insert into operations_profiles(user_id,organization_name,organization_type,verification_status) values($1,'Test NGO','ngo','approved')",[other]);
  await login(other);assert.equal((await db.query('select transcript from evidence where id=$1',[row.id])).rows[0].transcript,corrected);
  await db.query("select public.nigraan_update_incident_status($1,'reported','acknowledged')",[id]);
  await owner();
  // Service-only request budget is persistent and counts failed attempts.
  for(let index=0;index<3;index++)await db.query("select public.nigraan_start_transcription($1,$2,'auto')",[citizen,'b'.repeat(64)]);
  await assert.rejects(()=>db.query("select public.nigraan_start_transcription($1,$2,'auto')",[citizen,'b'.repeat(64)]),/limit reached/);
  console.log('006 passed: legacy rows/RLS/private bucket preserved, audio optional, Unicode corrections + provenance atomic, receipt forgery/reuse rejected, status workflow and server-only quotas checked.');
  const previousJobs=(await db.query('select * from nigraan_transcription_jobs order by id')).rows;
  const previousSecurity=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  await db.exec(await sql('007_transcription_quota_tuning.sql'));
  assert.deepEqual((await db.query('select * from nigraan_transcription_jobs order by id')).rows.map(({active_until,...row})=>row),previousJobs);
  assert.deepEqual((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,previousSecurity);
  const start=async(user=citizen)=>(await db.query("select public.nigraan_start_transcription($1,$2,'auto')",[user,'b'.repeat(64)])).rows[0].nigraan_start_transcription;
  const complete=job=>db.query("update nigraan_transcription_jobs set status='failed',active_until=null where id=$1",[job]);
  // Legacy pending jobs participate in the bounded guard without being rewritten.
  await assert.rejects(()=>start(),error=>error.code==='PT409'&&JSON.parse(error.detail).code==='transcription_busy');
  await db.query("update nigraan_transcription_jobs set status='failed' where user_id=$1 and status='pending'",[citizen]);
  const admitted=await start(); // Existing five no longer exhaust the short window.
  const countBefore=(await db.query('select count(*)::int as n from nigraan_transcription_jobs')).rows[0].n;
  await assert.rejects(()=>start(),error=>error.code==='PT409');
  assert.equal((await db.query('select count(*)::int as n from nigraan_transcription_jobs')).rows[0].n,countBefore);
  const independent=await start(other);await complete(independent);await complete(admitted);
  for(let index=0;index<4;index++)await complete(await start());
  await assert.rejects(()=>start(),error=>error.code==='PT429'&&JSON.parse(error.detail).code==='app_quota_short'&&JSON.parse(error.detail).retry_after>0);
  // Window ages naturally; old failed attempts still count toward daily quota.
  await db.query("update nigraan_transcription_jobs set created_at=now()-interval '11 minutes' where user_id=$1",[citizen]);
  const stale=await start();await db.query("update nigraan_transcription_jobs set active_until=now()-interval '1 second' where id=$1",[stale]);
  const recovered=await start();await complete(recovered);await complete(stale);
  for(let index=0;index<88;index++){
    const job=await start();await complete(job);
    // Move only fixture timestamps outside the short window to exercise daily cap.
    await db.query("update nigraan_transcription_jobs set created_at=now()-interval '11 minutes' where id=$1",[job]);
  }
  await assert.rejects(()=>start(),error=>error.code==='PT429'&&JSON.parse(error.detail).code==='app_quota_daily');
  await db.query("update nigraan_transcription_jobs set created_at=now()-interval '25 hours' where user_id=$1",[citizen]);
  await complete(await start()); // Rolling daily expiry restores capacity.
  await login(citizen);
  await assert.rejects(()=>start(),/permission denied/);
  await assert.rejects(()=>db.query('select * from nigraan_transcription_jobs'),/permission denied/);
  console.log('007 passed: jobs/RLS preserved; 10/100 rolling quotas, failed attempts, active rejection without quota waste, account isolation, stale-lease recovery and expiry checked.');
  await owner();
  const beforeEight=(await db.query('select * from evidence order by id')).rows;
  const securityBeforeEight=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  await db.exec(await sql('008_citizen_report_edits_updates.sql'));
  assert.deepEqual((await db.query('select * from evidence order by id')).rows.map(({citizen_change_id,...row})=>row),beforeEight);
  assert.deepEqual((await db.query("select * from pg_policies where tablename<>'nigraan_citizen_changes' order by schemaname,tablename,policyname")).rows,securityBeforeEight);
  assert.equal((await db.query("select public from storage.buckets where id='incident-evidence'")).rows[0].public,false);
  const fields={title:'Citizen correction',description:'درست تفصیل',category:'garbage',area:'Corrected area',latitude:24.9,longitude:67.1,location_accuracy:8};
  const changeBegin=async(incidentId,kind='edit',payload=fields,body='')=>{const version=(await db.query('select updated_at from incidents where id=$1',[incidentId])).rows[0]?.updated_at;const change=crypto.randomUUID();await db.query('select public.nigraan_begin_citizen_change($1,$2,$3,$4,$5,$6)',[change,incidentId,kind,payload?JSON.stringify(payload):null,body,version]);return change;};
  const changeFinish=(change,files=[])=>db.query('select public.nigraan_finalize_citizen_change($1,$2)',[change,JSON.stringify(files)]);
  const changeUpload=async(change,mime)=>{const path=citizen+'/'+original+'/'+change+'/'+crypto.randomUUID()+'.'+(mime==='image/jpeg'?'jpg':'webm');await db.query("insert into storage.objects(bucket_id,name,metadata) values('incident-evidence',$1,$2)",[path,JSON.stringify({mimetype:mime,size:100})]);return {storage_path:path,source:mime==='image/jpeg'?'upload':'recording'};};
  await login(citizen);
  await assert.rejects(()=>changeBegin(original,'edit',{...fields,status:'resolved'}),/citizen-controlled/);
  const edit=await changeBegin(original);const staleEdit=await changeBegin(original);
  await changeFinish(edit);
  const correctedIncident=(await db.query('select * from incidents where id=$1',[original])).rows[0];
  assert.equal(correctedIncident.title,fields.title);assert.equal(correctedIncident.category,'garbage');assert.equal(correctedIncident.latitude,24.9);assert.equal(correctedIncident.status,'reported');assert.equal(correctedIncident.priority,'normal');assert.equal(correctedIncident.assigned_organization_id,null);
  const history=(await db.query('select * from nigraan_citizen_changes where id=$1',[edit])).rows[0];
  assert.equal(history.submission_state,'published');assert.equal(history.original_snapshot.title,'Title');assert.equal(history.previous_values.title,'Title');assert.equal(history.new_values.title,fields.title);assert.ok(history.published_at);
  await assert.rejects(()=>changeFinish(staleEdit),/changed/);
  await assert.rejects(()=>db.query("update nigraan_citizen_changes set body='rewritten' where id=$1",[edit]),/permission denied/);
  await assert.rejects(()=>db.query('select public.nigraan_abandon_citizen_change($1)',[edit]),/cannot be removed/);
  // Draft UUID collisions cannot unlock original evidence in the three-part namespace.
  const version=(await db.query('select updated_at from incidents where id=$1',[original])).rows[0].updated_at;
  await db.query('select public.nigraan_begin_citizen_change($1,$2,\'edit\',$3,\'\',$4)',[original,original,JSON.stringify({...fields,title:'Collision draft'}),version]);
  assert.equal((await db.query("select public.nigraan_storage_access($1,'write') as allowed",[oldPhoto.storage_path])).rows[0].allowed,false);
  await db.query('select public.nigraan_abandon_citizen_change($1)',[original]);
  const afterUpgradeReport=await begin();const afterUpgradePhoto=await upload(afterUpgradeReport,'image/jpeg');await finalize(afterUpgradeReport,[afterUpgradePhoto]);
  // A real status RPC between begin/save invalidates the original edit.
  const racing=await changeBegin(original,'edit',{...fields,title:'Too late'});
  const racePhoto=await changeUpload(racing,'image/jpeg');
  await login(other);await assert.rejects(()=>changeBegin(original),/report was not found/);
  await db.query("select public.nigraan_update_incident_status($1,'reported','acknowledged')",[original]);
  await login(citizen);await assert.rejects(()=>changeFinish(racing,[racePhoto]),/already being processed/);
  await assert.rejects(()=>changeBegin(original),/already being processed/);
  assert.equal((await db.query('select title from incidents where id=$1',[original])).rows[0].title,fields.title);
  assert.equal((await db.query('select * from evidence where citizen_change_id=$1',[racing])).rows.length,0);
  await db.query('delete from storage.objects where name=$1',[racePhoto.storage_path]);await db.query('select public.nigraan_abandon_citizen_change($1)',[racing]);
  // Text-only append updates do not change original fields, status or priority.
  const update=await changeBegin(original,'update',null,'The water level has increased.');await changeFinish(update);
  assert.equal((await db.query('select title from incidents where id=$1',[original])).rows[0].title,fields.title);
  await assert.rejects(()=>db.query('delete from nigraan_citizen_changes where id=$1',[update]),/permission denied/);
  // New private update photo/audio plus a server-issued transcript receipt.
  const updateFiles=await changeBegin(original,'update',null,'نئی اطلاع');
  const updatePhoto=await changeUpload(updateFiles,'image/jpeg');const updateAudio=await changeUpload(updateFiles,'audio/webm');
  await owner();const receipt=crypto.randomUUID();
  await db.query("insert into nigraan_transcription_jobs(id,user_id,audio_sha256,selected_language,status,machine_text,completed_at,bound_path) values($1,$2,$3,'ur','ready',$4,now(),$5)",[receipt,citizen,'d'.repeat(64),'اصل متن',updateAudio.storage_path]);
  await login(citizen);await changeFinish(updateFiles,[updatePhoto,{...updateAudio,transcription_job:receipt,transcript:'شہری کی تصحیح',transcript_reviewed:true}]);
  const newEvidence=(await db.query('select * from evidence where citizen_change_id=$1',[updateFiles])).rows;
  assert.equal(newEvidence.length,2);assert.equal(newEvidence.find(row=>row.media_type==='audio').machine_transcript,'اصل متن');assert.equal(newEvidence.find(row=>row.media_type==='audio').transcription_status,'confirmed');
  assert.equal((await db.query("select public.nigraan_storage_access($1,'write') as allowed",[updatePhoto.storage_path])).rows[0].allowed,false);
  // A crafted new incident draft sharing a published change UUID also cannot
  // unlock four-part activity evidence.
  await db.query("select public.nigraan_begin_incident($1,'Collision','Description','water','Area',24.8,67,10)",[updateFiles]);
  assert.equal((await db.query("select public.nigraan_storage_access($1,'write') as allowed",[updatePhoto.storage_path])).rows[0].allowed,false);
  await db.query('select public.nigraan_abandon_draft($1)',[updateFiles]);
  assert.equal((await db.query("select public.nigraan_storage_access($1,'read') as allowed",[oldPhoto.storage_path])).rows[0].allowed,true);
  const draftOnly=await changeBegin(original,'update',null,'Private pending clarification');const draftPhoto=await changeUpload(draftOnly,'image/jpeg');
  await login(other);
  assert.equal((await db.query('select * from nigraan_citizen_changes where id=$1',[draftOnly])).rows.length,0);
  assert.equal((await db.query('select * from nigraan_citizen_changes where id=$1',[updateFiles])).rows.length,1);
  assert.equal((await db.query("select public.nigraan_storage_access($1,'read') as allowed",[updatePhoto.storage_path])).rows[0].allowed,true);
  assert.equal((await db.query("select public.nigraan_storage_access($1,'read') as allowed",[draftPhoto.storage_path])).rows[0].allowed,false);
  assert.equal((await db.query('select * from evidence where citizen_change_id=$1',[updateFiles])).rows.length,2);
  await assert.rejects(()=>changeBegin(original,'update',null,'Forged other citizen update'),/report was not found/);
  await db.query("select public.nigraan_update_incident_status($1,'acknowledged','assigned')",[original]);await db.query("select public.nigraan_update_incident_status($1,'assigned','in_progress')",[original]);
  await login(citizen);const finalDraft=await changeBegin(original,'update',null,'Before resolution');
  await login(other);await db.query("select public.nigraan_update_incident_status($1,'in_progress','resolved')",[original]);
  await login(citizen);await assert.rejects(()=>changeFinish(finalDraft),/completed/);await assert.rejects(()=>changeBegin(original,'update',null,'Reopen'),/processing/);await assert.rejects(()=>changeBegin(original),/already being processed/);
  assert.equal((await db.query('select body from nigraan_citizen_changes where id=$1',[update])).rows[0].body,'The water level has increased.');
  // A stranger with no Operations access cannot read any activity/evidence/files.
  await owner();const stranger='00000000-0000-4000-8000-000000000099';await db.query('insert into auth.users(id) values($1)',[stranger]);
  await login(stranger);assert.equal((await db.query('select * from nigraan_citizen_changes where incident_id=$1',[original])).rows.length,0);assert.equal((await db.query('select * from evidence where citizen_change_id=$1',[updateFiles])).rows.length,0);
  assert.equal((await db.query("select public.nigraan_storage_access($1,'read') as allowed",[updateAudio.storage_path])).rows[0].allowed,false);
  await assert.rejects(()=>changeBegin(original,'update',null,'Another citizen'),/report was not found/);
  console.log('008 passed: data/private bucket/policies preserved, owner-only audited edits, field allowlist, stale/status races, append-only active updates, private evidence/transcripts, Operations visibility/workflow and resolved read-only.');
} finally {await db.close();}
