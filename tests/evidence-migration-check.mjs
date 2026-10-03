// Local PostgreSQL fixture only; its legacy CHECK lists are deliberately synthetic,
// not assertions about the user's actual project. Optional runtime: see README.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../review/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const sql=async name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const db=new PGlite();
const citizen='00000000-0000-4000-8000-000000000001';
const stranger='00000000-0000-4000-8000-000000000009';
const initial='00000000-0000-4000-8000-000000000002';
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema auth,storage to anon,authenticated;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(id uuid primary key references auth.users(id),display_name text not null,
      email text,phone text,avatar_url text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.incidents(id uuid primary key default gen_random_uuid(),reporter_id uuid not null references profiles(id),
      title text not null,description text not null,category text not null,status text not null default 'reported',
      latitude double precision not null,longitude double precision not null,location_accuracy double precision,
      reported_at timestamptz default now(),updated_at timestamptz default now());
    create table public.evidence(id uuid primary key default gen_random_uuid(),incident_id uuid not null references incidents(id),
      uploader_id uuid not null references profiles(id),storage_path text not null,media_type text not null,
      source text not null,file_size integer not null,width integer,height integer,captured_at timestamptz,
      created_at timestamptz default now(),transcription_status text not null default 'pending',
      constraint evidence_media_type_check check(media_type in ('image','audio')),
      constraint evidence_source_check check(source in ('camera','upload')),
      constraint old_evidence_size_check check(file_size between 1 and 5242880),
      constraint old_transcription_check check(transcription_status in ('pending','ready')),
      constraint evidence_dimensions_check check((width is null or width>0) and (height is null or height>0)));
    create table storage.buckets(id text primary key,name text,public boolean default false,
      file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),
      name text not null,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    insert into auth.users(id) values('${citizen}'),('${stranger}');
    insert into profiles(id,display_name) values('${citizen}','Test citizen'),('${stranger}','Other citizen');
    insert into incidents(id,reporter_id,title,description,category,latitude,longitude)
      values('${initial}','${citizen}','Test','Test','water',24.8,67);
    insert into evidence(incident_id,uploader_id,storage_path,media_type,source,file_size)
      values('${initial}','${citizen}','legacy/photo.jpg','image','upload',100);
  `);
  await db.exec(await sql('002_accounts_evidence_upgrade.sql'));
  await db.exec(await sql('003_fix_incident_categories.sql'));
  const owner=()=>db.exec('reset role');
  const login=async(user=citizen)=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    await db.exec('set role authenticated');
  };
  const begin=async()=>{
    const id=crypto.randomUUID();
    await db.query("select public.nigraan_begin_incident($1,'Title','Description','water','Area',24.8,67,10)",[id]);
    return id;
  };
  const upload=async(id,mime,source='upload',size=100)=>{
    const path=citizen+'/'+id+'/'+crypto.randomUUID()+'.'+({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a' }[mime.split(';')[0]]||'bin');
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('incident-evidence',$1,$2)",[path,JSON.stringify({mimetype:mime,size})]);
    return {storage_path:path,source};
  };
  const finalize=(id,attachments)=>db.query('select public.nigraan_finalize_incident($1,$2)',[id,JSON.stringify(attachments)]);
  await login();
  const failed=await begin();
  const failedPhoto=await upload(failed,'image/jpeg');
  await assert.rejects(()=>finalize(failed,[failedPhoto]),/evidence_media_type_check/);
  assert.equal((await db.query('select submission_state from incidents where id=$1',[failed])).rows[0].submission_state,'draft');
  assert.equal((await db.query('select * from evidence where incident_id=$1',[failed])).rows.length,0);
  assert.equal((await db.query('select * from storage.objects where name=$1',[failedPhoto.storage_path])).rows.length,1);
  // Storage deletion is a separate API operation; simulate the authorized metadata
  // deletion locally, then invoke the real deployed draft cleanup RPC.
  await db.query('delete from storage.objects where name=$1',[failedPhoto.storage_path]);
  await db.query('select public.nigraan_abandon_draft($1)',[failed]);
  assert.equal((await db.query('select * from incidents where id=$1',[failed])).rows.length,0);
  await owner();
  const legacy=(await db.query('select * from evidence')).rows;
  const security=async()=>({
    rls:(await db.query("select relname,relrowsecurity from pg_class where oid in ('public.evidence'::regclass,'storage.objects'::regclass)")).rows,
    policies:(await db.query("select * from pg_policies where tablename in ('evidence','objects') order by schemaname,policyname")).rows,
    bucket:(await db.query("select * from storage.buckets where id='incident-evidence'")).rows,
  });
  const beforeSecurity=await security();
  const migration=await sql('004_fix_evidence_constraints.sql');
  await db.exec(migration);
  assert.deepEqual(await security(),beforeSecurity);
  assert.deepEqual((await db.query('select * from evidence')).rows.map(({mime_type,...row})=>row),legacy);
  assert.equal((await db.query('select mime_type from evidence')).rows[0].mime_type,null);
  const names=(await db.query("select conname from pg_constraint where conrelid='public.evidence'::regclass")).rows.map(row=>row.conname);
  assert.ok(names.includes('evidence_dimensions_check'));
  for(const name of ['evidence_source_check','old_evidence_size_check','old_transcription_check'])assert.ok(!names.includes(name));
  await login();
  // Six photo format/source combinations and all three optional voice formats.
  for(const mime of ['image/jpeg','image/png','image/webp'])for(const source of ['camera','upload']){
    const id=await begin();
    const attachments=[await upload(id,mime,source,5242880)];
    for(const audioMime of ['audio/webm','audio/ogg','audio/mp4'])attachments.push(await upload(id,audioMime+';codecs=opus','recording',10485760));
    // Browser labels are untrusted and must be ignored in favor of Storage MIME.
    attachments[0].media_type='audio'; attachments[0].mime_type='audio/ogg';
    await finalize(id,attachments);
    const rows=(await db.query('select media_type,mime_type,source,file_size from evidence where incident_id=$1 order by mime_type',[id])).rows;
    assert.equal(rows.length,4);
    assert.ok(rows.every(row=>row.media_type===row.mime_type.split('/')[0]));
    assert.ok(rows.filter(row=>row.media_type==='audio').every(row=>row.source==='recording'&&row.file_size===10485760));
    assert.equal(rows.find(row=>row.media_type==='image').source,source);
    await finalize(id,attachments); // Idempotent; no duplicate evidence.
    assert.equal((await db.query('select count(*)::integer as n from evidence where incident_id=$1',[id])).rows[0].n,4);
    // Finalized evidence cannot be removed with the draft Storage delete policy.
    assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[attachments[0].storage_path])).rows.length,0);
  }
  for(const scenario of ['voice-only','bad-source','bad-mime','oversize','duplicate','check-failure']){
    const id=await begin();
    const photo=await upload(id,'image/jpeg');
    let attachments=[photo];
    let pattern;
    if(scenario==='voice-only'){attachments=[await upload(id,'audio/webm','recording')];pattern=/At least one uploaded photo/;}
    if(scenario==='bad-source'){attachments.push(await upload(id,'audio/ogg','upload'));pattern=/Invalid voice recording/;}
    if(scenario==='bad-mime'){attachments.push(await upload(id,'video/mp4','recording'));pattern=/Unsupported evidence type/;}
    if(scenario==='oversize'){attachments.push(await upload(id,'image/png','camera',5242881));pattern=/Photo exceeds/;}
    if(scenario==='duplicate'){attachments.push(photo);pattern=/duplicate path/;}
    if(scenario==='check-failure'){
      await owner(); await db.exec("alter table evidence add constraint simulated_db_failure check(file_size<>101) not valid"); await login();
      attachments.push(await upload(id,'audio/webm','recording',101));pattern=/simulated_db_failure/;
    }
    await assert.rejects(()=>finalize(id,attachments),pattern);
    assert.equal((await db.query('select * from evidence where incident_id=$1',[id])).rows.length,0);
    assert.equal((await db.query('select submission_state from incidents where id=$1',[id])).rows[0].submission_state,'draft');
    await db.query('delete from storage.objects where name like $1',[citizen+'/'+id+'/%']);
    await db.query('select public.nigraan_abandon_draft($1)',[id]);
    if(scenario==='check-failure'){await owner(); await db.exec('alter table evidence drop constraint simulated_db_failure'); await login();}
  }
  const privateDraft=await begin();
  const privatePhoto=await upload(privateDraft,'image/jpeg');
  await login(stranger);
  await assert.rejects(()=>finalize(privateDraft,[privatePhoto]),/Incident not found/);
  await assert.rejects(()=>db.query("insert into evidence(incident_id,uploader_id,storage_path,media_type,source,file_size,mime_type) values($1,$2,'forged','image','upload',100,'image/jpeg')",[privateDraft,stranger]),/permission denied/);
  await owner();
  assert.equal((await db.query("select has_function_privilege('anon','public.nigraan_finalize_incident(uuid,jsonb)','execute') as allowed")).rows[0].allowed,false);
  await db.exec(migration); // Retry preserves every existing evidence value.
  await db.exec('alter table evidence add constraint unexpected_path_rule check(length(storage_path)<10) not valid');
  await assert.rejects(()=>db.exec(migration),/Review unrelated\/custom evidence CHECK/);
  await db.exec('rollback');
  assert.equal((await db.query("select count(*)::integer as n from pg_constraint where conname='unexpected_path_rule'")).rows[0].n,1);
  console.log('004 passed: actual deployed RPC mismatch reproduced; canonical photo/audio, MIME/source/size, legacy preservation, unchanged RLS/private bucket, atomic rollback, cleanup permissions, ownership, retries and custom-rule safeguard verified locally.');
} finally {await db.close();}
