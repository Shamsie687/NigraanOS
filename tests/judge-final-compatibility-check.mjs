// Synthetic in-memory PostgreSQL only; private catalog capture read, never logged.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {baseline,tokens} from '../scripts/review-judge-schema.mjs';
const db=await baseline();let checks=0;
const check=(name,value)=>{assert.ok(value,name);checks++;console.log('PASS: '+name);};
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
try{
 let capture=JSON.parse(await readFile(process.argv[2],'utf8'));
 if(Array.isArray(capture))capture=capture[0];capture=capture.private_schema_review||capture;if(typeof capture==='string')capture=JSON.parse(capture);
 assert.equal(capture.format,'nigraan-judge-schema-review-v1');
 const f=capture.functions.find(x=>x.name==='handle_updated_at');
 assert.equal(tokens(f.source),tokens('begin new.updated_at = now(); return new; end;'));
 const migration=await sql('018_pin_reviewed_timestamp_search_path.sql');
 // Only verified timestamp source is used, never any other captured DDL.
 assert.ok(!f.source.includes('$synthetic$'));
 await db.exec(`create function public.handle_updated_at() returns trigger language plpgsql security definer as $synthetic$${f.source}$synthetic$;
 create trigger on_incident_updated before update on public.incidents for each row execute function public.handle_updated_at();
 create trigger on_profile_updated before update on public.profiles for each row execute function public.handle_updated_at();`);
 await db.exec('revoke all on function public.handle_updated_at() from public,anon,authenticated,service_role;');
 for(const g of f.grants){assert.ok(['postgres','PUBLIC','anon','authenticated','service_role'].includes(g.role));assert.equal(g.privilege,'EXECUTE');await db.exec(`grant execute on function public.handle_updated_at() to ${g.role}${g.grantable?' with grant option':''};`);}
 const metadata=async()=> (await db.query("select prosrc,proowner,proacl,prosecdef,provolatile,proargtypes::text,prorettype from pg_proc where oid='public.handle_updated_at()'::regprocedure")).rows[0];
 const before=await metadata();
 await db.exec(migration);
 check('018 pins only pg_catalog',JSON.stringify((await db.query("select proconfig from pg_proc where oid='public.handle_updated_at()'::regprocedure")).rows[0].proconfig)===JSON.stringify(['search_path=pg_catalog']));
 check('body/signature/owner/security/volatility/grants preserved',JSON.stringify(await metadata())===JSON.stringify(before));
 await db.exec("update public.profiles set updated_at='2000-01-01';");
 check('Citizen profile timestamp behavior retained',(await db.query("select bool_and(updated_at>'2026-01-01') ok from profiles")).rows[0].ok);
 const profile=(await db.query('select id from profiles limit 1')).rows[0].id;
 await db.query("insert into incidents(reporter_id,title,description,category,latitude,longitude,submission_state) values($1,'Synthetic','Synthetic','water',24,67,'draft')",[profile]);
 await db.exec("update public.incidents set updated_at='2000-01-01';");
 check('incident timestamp behavior retained',(await db.query("select bool_and(updated_at>'2026-01-01') ok from incidents")).rows[0].ok);
 await db.exec("create schema hostile; create function hostile.now() returns timestamptz language sql as $$select '2000-01-01'::timestamptz$$; set search_path=hostile,pg_catalog,public; update public.profiles set updated_at='2000-01-01'; reset search_path;");
 check('caller search_path cannot shadow now()', (await db.query("select bool_and(updated_at>'2026-01-01') ok from profiles")).rows[0].ok);
 await db.exec(migration);check('018 safe repeat preserves metadata',JSON.stringify(await metadata())===JSON.stringify(before));
 await db.exec("alter function public.handle_updated_at() set search_path=hostile;");
 await assert.rejects(db.exec(migration));await db.exec('rollback;');check('unexpected config aborts transaction',JSON.stringify((await db.query("select proconfig from pg_proc where oid='public.handle_updated_at()'::regprocedure")).rows[0].proconfig)===JSON.stringify(['search_path=hostile']));
 await db.exec('alter function public.handle_updated_at() set search_path=pg_catalog;');
 await db.exec('grant execute on function public.handle_updated_at() to anon;');
 if(!f.grants.some(g=>g.role==='anon')){await assert.rejects(db.exec(migration));await db.exec('rollback;');check('ACL drift refuses hardening',true);await db.exec('revoke execute on function public.handle_updated_at() from anon;');}
 await db.exec('create role synthetic_extra; grant execute on function public.handle_updated_at() to synthetic_extra;');await assert.rejects(db.exec(migration));await db.exec('rollback;');check('additional ACL privilege refuses hardening',true);await db.exec('revoke execute on function public.handle_updated_at() from synthetic_extra;');
 await db.exec('alter table profiles disable trigger on_profile_updated;');await assert.rejects(db.exec(migration));await db.exec('rollback;');check('disabled trigger refuses hardening',true);await db.exec('alter table profiles enable trigger on_profile_updated;');
 // Assemble only the already reviewed policy shape in the synthetic baseline.
 // CREATE POLICY parses expressions; no captured function/SQL statement runs.
 const expectedPolicies=(await db.query('select policyname from pg_policies')).rows.map(p=>p.policyname);
 for(const p of capture.policies.filter(p=>!expectedPolicies.includes(p.name))){
  assert.ok(['profiles','incidents','evidence'].includes(p.table)&&p.schema==='public'&&p.permissive);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/i.test((p.using||'')+(p.check||'')));
  assert.ok(p.roles.every(r=>['public','authenticated'].includes(r)));
  const cmd={r:'SELECT',a:'INSERT',w:'UPDATE',d:'DELETE'}[p.command];assert.ok(cmd);
  await db.exec(`create policy "${p.name.replaceAll('"','""')}" on public.${p.table} for ${cmd} to ${p.roles.join(',')} ${p.using?'using ('+p.using+')':''} ${p.check?'with check ('+p.check+')':''};`);
 }
 const around=capture.functions.find(f=>f.name==='nigraan_around_me_build');
 const baselineSource=(await db.query("select prosrc from pg_proc where oid='public.nigraan_around_me_build()'::regprocedure")).rows[0].prosrc;
 assert.equal(tokens(around.source),tokens(baselineSource));assert.ok(!around.source.includes('$synthetic$'));
 await db.exec(`create or replace function public.nigraan_around_me_build() returns date language plpgsql security definer set search_path='' as $synthetic$${around.source}$synthetic$;`);
 await db.exec('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text); alter table auth.users add column email_confirmed_at timestamptz;');
 const preSQL=await readFile(new URL('../docs/JUDGE_PRODUCTION_FINAL_PREFLIGHT.sql',import.meta.url),'utf8');
 const pre=await db.query(preSQL);
 if(pre.rows[0].verdict==='BLOCKED'){const source=(await db.query("select prosrc from pg_proc where oid='public.nigraan_around_me_build()'::regprocedure")).rows[0].prosrc;console.log('Synthetic exact-source preservation: '+JSON.stringify({equal:source===around.source,sqlLength:source.length,capturedLength:around.source.length}));}
 if(pre.rows[0].verdict!=='PASS_REQUIRES_015_016_017_018')console.log('Synthetic preflight mismatches: '+pre.rows[0].actionable_mismatches.map(x=>x.check).join(', '));
 check('reviewed complete final preflight passes with required hardening plan',pre.rows[0].verdict==='PASS_REQUIRES_015_016_017_018');
 await db.exec('alter table public.evidence disable row level security;');
 const unsafe=await db.query(await readFile(new URL('../docs/JUDGE_PRODUCTION_FINAL_PREFLIGHT.sql',import.meta.url),'utf8'));
 check('final preflight rejects RLS regression',unsafe.rows[0].verdict==='BLOCKED');await db.exec('alter table public.evidence enable row level security;');
 // Simulate inherited defaults and apply all four migrations in the exact order.
 await db.exec('alter default privileges for role postgres grant execute on functions to service_role;');
 for(const name of ['015_temporary_judge_access.sql','016_gmail_notification_retry_safety.sql','017_judge_rpc_service_role_hardening.sql','018_pin_reviewed_timestamp_search_path.sql'])await db.exec(await sql(name));
 const post=await db.query(await readFile(new URL('../docs/JUDGE_PRODUCTION_POSTDEPLOY_CHECK.sql',import.meta.url),'utf8'));
 check('four-migration catalog postcheck passes',post.rows[0].verdict==='PASS');
 await db.exec('grant execute on function public.nigraan_decide_judge_access(uuid,text) to service_role;');
 const bad=await db.query(await readFile(new URL('../docs/JUDGE_PRODUCTION_POSTDEPLOY_CHECK.sql',import.meta.url),'utf8'));
 check('postcheck detects service-role privilege regression',bad.rows[0].verdict==='BLOCKED');
 console.log('TOTAL: '+checks+' PASS; isolated PGlite, no hosted SQL or private definition output.');
}catch(error){const line=error?.stack?.match(/judge-final-compatibility-check\.mjs:(\d+):/)?.[1];console.error('BLOCKED: synthetic compatibility test failed'+(line?' at test line '+line:'')+'; no private definitions printed.');process.exitCode=1;}finally{await db.close();}
