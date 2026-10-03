// Isolated PostgreSQL test. No real accounts, files or database access.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../review/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const citizen='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const legacyOps='00000000-0000-4000-8000-000000000003';
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    grant usage on schema auth,storage to anon,authenticated;
    create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}');
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
      created_at timestamptz default now());
    create table storage.buckets(id text primary key,name text,public boolean default false,
      file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),
      name text not null,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    insert into auth.users(id,email) values('${citizen}','citizen@example.test'),('${other}','other@example.test'),('${legacyOps}','legacy@example.test');
    insert into profiles(id,display_name) values('${citizen}','Citizen'),('${other}','Other'),('${legacyOps}','Legacy Ops');
  `);
  for(const name of ['002_accounts_evidence_upgrade.sql','003_fix_incident_categories.sql','004_fix_evidence_constraints.sql'])await db.exec(await sql(name));
  await db.exec(`update profiles set account_type='operations' where id='${legacyOps}';
    insert into operations_profiles(user_id,organization_name,organization_type,verification_status) values('${legacyOps}','Legacy NGO','ngo','approved')`);
  const before=(await db.query('select * from profiles order by id')).rows;
  const policies=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  const five=await sql('005_multi_workspace_access.sql');
  await db.exec(five);
  assert.deepEqual((await db.query('select * from profiles order by id')).rows,before);
  assert.deepEqual((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,policies);
  assert.equal((await db.query("select public from storage.buckets where id='incident-evidence'")).rows[0].public,false);
  const login=async user=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');};
  const owner=()=>db.exec('reset role');
  const begin=async()=>{
    const id=crypto.randomUUID();
    await db.query("select public.nigraan_begin_incident($1,'Title','Description','water','Area',24.8,67,10)",[id]);
    return id;
  };
  const report=async user=>{
    await login(user);const id=await begin();const path=user+'/'+id+'/'+crypto.randomUUID()+'.jpg';
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('incident-evidence',$1,'{\"mimetype\":\"image/jpeg\",\"size\":100}')",[path]);
    await db.query('select public.nigraan_finalize_incident($1,$2)',[id,JSON.stringify([{storage_path:path,source:'upload'}])]);
    return {id,path};
  };
  const apply=(name='City NGO',type='ngo',detail='City contribution')=>db.query('select public.nigraan_apply_operations($1,$2,$3)',[name,type,detail]);
  const advance=(id,expected,next)=>db.query('select public.nigraan_update_incident_status($1,$2,$3)',[id,expected,next]);
  const first=await report(citizen);
  await assert.rejects(()=>advance(first.id,'reported','acknowledged'),/Approved Operations/);
  await assert.rejects(()=>apply('','ngo'),/Organization name/);
  await assert.rejects(()=>apply('NGO','admin'),/Invalid organization type/);
  await assert.rejects(()=>apply('NGO','ngo','x'.repeat(1001)),/Explanation/);
  await apply();
  assert.equal((await db.query('select verification_status from operations_profiles where user_id=$1',[citizen])).rows[0].verification_status,'pending');
  assert.equal((await db.query('select account_type from profiles where id=$1',[citizen])).rows[0].account_type,'citizen');
  await assert.rejects(()=>apply(),/already pending/);
  await assert.rejects(()=>db.query("update operations_profiles set verification_status='approved' where user_id=$1",[citizen]),/permission denied/);
  await assert.rejects(()=>db.query("update incidents set status='resolved' where id=$1",[first.id]),/permission denied/);
  await report(citizen); // Pending does not block Citizen reporting.
  const second=await report(other);
  await login(citizen);
  assert.equal((await db.query('select * from incidents where id=$1',[second.id])).rows.length,0);
  await assert.rejects(()=>advance(first.id,'reported','acknowledged'),/Approved Operations/);
  await owner();await db.query("update operations_profiles set verification_status='rejected' where user_id=$1",[citizen]);
  await report(citizen); // Rejected does not block Citizen reporting.
  await apply('Updated NGO');
  await owner();
  // Exercise the exact supplied project-owner approval script in the fixture.
  // The owner may privately customize this local script. Substitute BOTH email
  // predicates in memory; never execute/log the owner's literal in a fixture.
  const approval=(await readFile(new URL('../supabase/admin/approve_operations_for_testing.sql',import.meta.url),'utf8'))
    .replace(/(lower\((?:u\.)?email\)=lower\()'[^']*'(\))/g,"$1'citizen@example.test'$2");
  await db.exec(approval);
  await login(citizen);
  assert.equal((await db.query('select public.is_approved_operations() as allowed')).rows[0].allowed,true);
  assert.equal((await db.query('select * from incidents where id=$1',[second.id])).rows.length,1);
  assert.equal((await db.query('select * from evidence where incident_id=$1',[second.id])).rows.length,1);
  assert.equal((await db.query('select * from storage.objects where name=$1',[second.path])).rows.length,1);
  await report(citizen); // Approved does not block Citizen reporting either.
  await assert.rejects(()=>apply(),/already approved/);
  await assert.rejects(()=>advance(second.id,'reported','resolved'),/Invalid workflow/);
  const draft=await begin();
  await assert.rejects(()=>advance(draft,'reported','acknowledged'),/Submitted incident not found/);
  await advance(second.id,'reported','acknowledged');
  await assert.rejects(()=>advance(second.id,'reported','acknowledged'),/Status changed/);
  await advance(second.id,'acknowledged','assigned');
  assert.equal((await db.query('select assigned_organization_id from incidents where id=$1',[second.id])).rows[0].assigned_organization_id,citizen);
  await advance(second.id,'assigned','in_progress');
  await advance(second.id,'in_progress','resolved');
  await assert.rejects(()=>advance(second.id,'resolved','reported'),/Invalid workflow/);
  await login(other);
  assert.equal((await db.query('select status from incidents where id=$1',[second.id])).rows[0].status,'resolved');
  await assert.rejects(()=>advance(second.id,'resolved','reported'),/Approved Operations/);
  await report(legacyOps); // Existing Operations account keeps access to both workspaces.
  await owner();await db.query("update operations_profiles set verification_status='rejected' where user_id=$1",[citizen]);
  await login(citizen);
  assert.equal((await db.query('select * from incidents where id=$1',[second.id])).rows.length,0);
  assert.equal((await db.query('select * from evidence where incident_id=$1',[second.id])).rows.length,0);
  assert.equal((await db.query('select * from storage.objects where name=$1',[second.path])).rows.length,0);
  await assert.rejects(()=>advance(first.id,'reported','acknowledged'),/Approved Operations/);
  await owner();
  const normalSignup=crypto.randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'normal@example.test','{\"display_name\":\"Normal\",\"account_type\":\"operations\",\"verification_status\":\"approved\"}')",[normalSignup]);
  assert.equal((await db.query('select account_type from profiles where id=$1',[normalSignup])).rows[0].account_type,'citizen');
  assert.equal((await db.query('select * from operations_profiles where user_id=$1',[normalSignup])).rows.length,0);
  // Simulate an older trigger trying to create approved Operations access from
  // signup metadata. The new deferred trigger must force this NEW request pending.
  await db.exec(`create function public.old_signup_trigger() returns trigger language plpgsql as $$ begin
    insert into profiles(id,display_name,account_type) values(new.id,'Metadata signup','operations');
    insert into operations_profiles(user_id,organization_name,organization_type,verification_status) values(new.id,'Old signup org','ngo','approved');
    return new; end $$;
    create trigger old_signup after insert on auth.users for each row execute function public.old_signup_trigger();`);
  const newUser=crypto.randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'new@example.test','{\"display_name\":\"New\",\"account_type\":\"operations\",\"verification_status\":\"approved\"}')",[newUser]);
  assert.equal((await db.query('select account_type from profiles where id=$1',[newUser])).rows[0].account_type,'citizen');
  assert.equal((await db.query('select verification_status from operations_profiles where user_id=$1',[newUser])).rows[0].verification_status,'pending');
  for(const signature of ['public.nigraan_apply_operations(text,text,text)','public.nigraan_update_incident_status(uuid,text,text)']){
    assert.equal((await db.query("select has_function_privilege('anon',$1,'execute') as allowed",[signature])).rows[0].allowed,false);
  }
  await db.exec(five); // Retry leaves applications and existing identities alone.
  // Optional Realtime configuration changes publication membership only.
  await db.exec('create publication supabase_realtime');
  const realtimeSetup=await readFile(new URL('../supabase/admin/enable_incidents_realtime.sql',import.meta.url),'utf8');
  await db.exec(realtimeSetup);await db.exec(realtimeSetup);
  assert.deepEqual((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows,[{tablename:'incidents'}]);
  assert.deepEqual((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,policies);
  console.log('005 passed: one identity, Citizen access at every verification state, owner-only approval, legacy Ops reporting, private city feed/evidence, sequential workflow, stale-write protection, revocation, signup metadata safety and unchanged policies.');
} finally {await db.close();}
