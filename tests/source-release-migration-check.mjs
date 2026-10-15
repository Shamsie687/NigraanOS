// Fresh, synthetic in-memory database only. No hosted connections or credentials.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();let checks=0;
const check=(name,ok)=>{assert.ok(ok,name);checks++;console.log('PASS: '+name);};
const sql=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const value=async(q,args=[])=>(await db.query(q,args)).rows[0].value;
const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
try{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage; grant usage on schema auth,storage to anon,authenticated;
 create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
 await db.exec(await sql('supabase/hackathon/000_release_baseline.sql'));
 for(const file of ['002_accounts_evidence_upgrade','003_fix_incident_categories','004_fix_evidence_constraints','005_multi_workspace_access','006_voice_transcription','007_transcription_quota_tuning','008_citizen_report_edits_updates','009_nigraan_ai','010_city_environment_context','011_security_harden_legacy_access','012_citizen_accountability','013_citizen_around_me','015_temporary_judge_access','016_gmail_notification_retry_safety','017_judge_rpc_service_role_hardening','019_judge_self_activation']){
  await db.exec(await sql('supabase/migrations/'+file+'.sql'));check(file,true);
 }
 check('fresh timestamp helper is invoker-only and pinned',await value("select not prosecdef and proconfig=array['search_path=pg_catalog'] value from pg_proc where oid='public.handle_updated_at()'::regprocedure"));
 const admin=crypto.randomUUID(),judge=crypto.randomUUID();
 for(const id of [admin,judge])await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[id,'synthetic-'+id+'@example.invalid']);
 await db.query("insert into operations_profiles(user_id,organization_name,organization_type,verification_status) values($1,'Synthetic organizer','other','approved') on conflict(user_id) do update set verification_status='approved'",[admin]);
 await db.query('insert into nigraan_judge_admins(user_id) values($1)',[admin]);
 await login(judge);const request=await value('select nigraan_request_judge_access() value');
 await assert.rejects(()=>db.query("select nigraan_decide_judge_access($1,'approved')",[request]));check('fresh judge cannot self-approve',true);
 await login(admin);await db.query("select nigraan_decide_judge_access($1,'approved')",[request]);
 await login(judge);let context=await value('select nigraan_operations_access_context() value');check('fresh approval has no Operations permission or session clock',!context.allowed&&context.status==='approved'&&context.started_at===null);
 context=await value('select nigraan_activate_judge_access() value');check('fresh activation grants one sixty-minute session',context.allowed&&context.status==='active'&&Date.parse(context.expires_at)-Date.parse(context.started_at)===3600000);
 const deadline=context.expires_at;check('fresh activation is idempotent',(await value('select nigraan_activate_judge_access() value')).expires_at===deadline);
 await db.exec('reset role');await db.query("with t as(select clock_timestamp()-interval '1 second' at_time) update nigraan_judge_requests set approved_at=t.at_time-interval '60 minutes',activation_expires_at=t.at_time-interval '60 minutes'+interval '48 hours',started_at=t.at_time-interval '60 minutes',expires_at=t.at_time from t where id=$1",[request]);
 await login(judge);check('fresh expired session denied',await value('select is_approved_operations() value')===false);
 check('fresh Citizen profile retained',await value('select count(*)::int value from profiles')===1);
 await login(admin);check('fresh permanent/admin capability retained',await value('select nigraan_is_permanent_operations() and nigraan_is_judge_admin() value'));
 console.log('TOTAL: '+checks+' PASS; fresh synthetic managed-service stubs, not hosted Supabase. Original-project-only 018 is deliberately excluded.');
}finally{await db.close();}
