import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../review/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const citizen='00000000-0000-4000-8000-000000000001',ops='00000000-0000-4000-8000-000000000002',second='00000000-0000-4000-8000-000000000003';
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
try {
  // Reuse only the schema bootstrap text of the established isolated fixture.
  const fixture=await readFile(new URL('./transcription-migration-check.mjs',import.meta.url),'utf8');
  const start=fixture.indexOf('await db.exec(`')+'await db.exec(`'.length;
  const end=fixture.indexOf('`);',start);
  await db.exec(fixture.slice(start,end).replaceAll('${citizen}',citizen).replaceAll('${other}',ops));
  for(const file of ['002_accounts_evidence_upgrade.sql','003_fix_incident_categories.sql','004_fix_evidence_constraints.sql','005_multi_workspace_access.sql','006_voice_transcription.sql','007_transcription_quota_tuning.sql','008_citizen_report_edits_updates.sql'])await db.exec(await sql(file));
  await db.exec(`insert into auth.users(id) values('${second}'); insert into profiles(id,display_name) values('${second}','Other ops'); insert into operations_profiles(user_id,organization_name,organization_type,verification_status) values('${ops}','Ops','ngo','approved'),('${second}','Other ops','ngo','approved');`);
  await db.query("update operations_profiles set verification_status='approved' where user_id=$1",[second]);
  const incident=crypto.randomUUID(),draft=crypto.randomUUID(),oldest=crypto.randomUUID();
  await db.query(`insert into incidents(id,reporter_id,title,description,category,latitude,longitude,submission_state,reported_at,updated_at) values($1,$2,'Private title','Private description','water',24.8,67,'submitted',now()-interval '2 days',now()),($3,$2,'Draft','Private','water',24.8,67,'draft',now(),now()),($4,$2,'Oldest','Private','garbage',24.8,67,'submitted',now()-interval '10 days',now())`,[incident,citizen,draft,oldest]);
  for(let i=0;i<10;i++)await db.query("insert into incidents(reporter_id,title,description,category,latitude,longitude,submission_state) values($1,'Report','Private','road_damage',24.8,67,'submitted')",[citizen]);
  const update=crypto.randomUUID();
  await db.query("insert into nigraan_citizen_changes(id,incident_id,citizen_id,kind,submission_state,body,published_at) values($1,$2,$3,'update','published','Private citizen text',now()),($4,$2,$3,'update','draft','Hidden update',null)",[update,incident,citizen,crypto.randomUUID()]);
  const before=(await db.query('select * from incidents order by id')).rows;
  const policies=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  const jobs=(await db.query('select * from nigraan_transcription_jobs')).rows;
  await db.exec(await sql('009_nigraan_ai.sql'));
  assert.deepEqual((await db.query('select * from incidents order by id')).rows,before);
  assert.deepEqual((await db.query('select * from nigraan_transcription_jobs')).rows,jobs);
  assert.deepEqual((await db.query("select * from pg_policies where tablename not like 'nigraan_ai_%' order by schemaname,tablename,policyname")).rows,policies);
  assert.equal((await db.query("select public from storage.buckets where id='incident-evidence'")).rows[0].public,false);
  const login=async user=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec('set role authenticated');};
  const owner=()=>db.exec('reset role');
  const snap=async(scope='briefing',category='all',selected=null)=>(await db.query('select nigraan_ai_snapshot($1,$2,24,$3) s',[scope,category,selected])).rows[0].s;
  const admit=()=>db.query('select nigraan_ai_admit()');
  for(const user of [null,citizen]){await login(user);await assert.rejects(()=>snap(),/Operations/);await assert.rejects(admit,/Operations/);}
  for(const status of ['pending','rejected']){await owner();await db.query('update operations_profiles set verification_status=$1 where user_id=$2',[status,ops]);await login(ops);await assert.rejects(()=>snap(),/Operations/);}
  await owner();await db.query("update operations_profiles set verification_status='approved' where user_id=$1",[ops]);await login(ops);
  const s=await snap();assert.equal(s.facts.matchingCount,12);assert.equal(s.facts.unresolvedCount,12);assert.equal(s.includedCount,8);assert.equal(s.omittedCount,4);assert.equal(s.facts.recentUpdateCount,1);assert.equal(s.facts.recentEditCount,0);assert.ok(!JSON.stringify(s).includes(draft));assert.ok(!JSON.stringify(s).includes('Hidden update'));assert.ok(!JSON.stringify(s).includes('Private citizen text'));
  assert.ok(!/reporter_id|latitude|longitude|storage_path|description/.test(JSON.stringify(s)));
  const long=await snap('longest');assert.equal(long.incidents[0].id,oldest);assert.ok(long.facts.oldestUnresolvedSeconds>=864000);assert.equal((await snap('briefing','road_damage')).facts.matchingCount,10);
  const recent=await snap('recent');assert.equal(recent.facts.matchingCount,1);assert.equal(recent.incidents[0].id,incident);
  await assert.rejects(()=>snap('incident','all',draft),/not available/);
  // Additional restrictive RLS proves this RPC cannot bypass future access rules.
  await owner();await db.exec(`create policy ai_fixture_restriction on incidents as restrictive for select to authenticated using(id<>'${oldest}');`);await login(ops);assert.equal((await snap()).facts.matchingCount,11);await assert.rejects(()=>snap('incident','all',oldest),/not available/);await owner();await db.exec('drop policy ai_fixture_restriction on incidents');await login(ops);
  await assert.rejects(()=>db.query('select * from nigraan_ai_requests'),/permission denied/);
  await assert.rejects(()=>db.query('insert into nigraan_ai_requests(user_id,active_until) values($1,now())',[ops]),/permission denied/);
  await admit();await assert.rejects(admit,error=>error.code==='PT409'&&JSON.parse(error.detail).code==='ai_busy');
  await login(second);await assert.rejects(admit,error=>error.code==='PT429'&&JSON.parse(error.detail).code==='shared_quota_short');
  await owner();await db.exec("update nigraan_ai_requests set created_at=now()-interval '61 seconds',active_until=now()-interval '1 second'");await login(ops);await admit();
  for(const [amount,age,code,user] of [[10,'2 minutes','app_quota_short',ops],[50,'1 hour','app_quota_daily',ops],[40,'1 hour','shared_quota_daily',second]]){
    await owner();await db.exec('delete from nigraan_ai_requests');await db.query(`insert into nigraan_ai_requests(user_id,created_at,active_until) select $1,now()-interval '${age}',now()-interval '1 second' from generate_series(1,$2)`,[user,amount]);await login(ops);await assert.rejects(admit,error=>error.code==='PT429'&&JSON.parse(error.detail).code===code);
  }
  await owner();await db.exec("update nigraan_ai_requests set created_at=now()-interval '25 hours'");await login(ops);
  const parallel=await Promise.allSettled([admit(),admit()]);assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1);assert.equal(parallel.filter(r=>r.status==='rejected').length,1);
  await owner();await db.query("update operations_profiles set verification_status='rejected' where user_id=$1",[ops]);await login(ops);await assert.rejects(()=>snap(),/Operations/);await assert.rejects(admit,/Operations/);
  console.log('009 passed: invoker RLS, approval/revocation, draft exclusions, full counts/bounds, report-age ordering, isolated quotas, concurrent admission/lease expiry, data/RLS/private Storage preservation.');
} finally {await db.close();}
