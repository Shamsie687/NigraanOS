import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../review/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();let checks=0;
const citizen='00000000-0000-4000-8000-000000000001',ops='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
const sql=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const ok=(value)=>{assert.ok(value);checks++;};
async function rejects(query,args=[]){await assert.rejects(db.query(query,args));checks++;}
async function actor(id,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);}
const count=async id=>(await db.query('select count(*)::int as n from nigraan_incident_workflow_events where incident_id=$1',[id])).rows[0].n;
try{
  const fixture=await readFile(new URL('./transcription-migration-check.mjs',import.meta.url),'utf8');
  const start=fixture.indexOf('await db.exec(`')+'await db.exec(`'.length,end=fixture.indexOf('`);',start);
  await db.exec(fixture.slice(start,end).replaceAll('${citizen}',citizen).replaceAll('${other}',ops));
  for(const file of ['002_accounts_evidence_upgrade.sql','003_fix_incident_categories.sql','004_fix_evidence_constraints.sql','005_multi_workspace_access.sql','006_voice_transcription.sql','007_transcription_quota_tuning.sql','008_citizen_report_edits_updates.sql'])await db.exec(await sql(file));
  await db.query("insert into auth.users(id) values($1)",[other]);await db.query("insert into profiles(id,display_name) values($1,'Other') on conflict do nothing",[other]);
  await db.query("insert into operations_profiles(user_id,organization_name,organization_type,verification_status) values($1,'Safe Org','ngo','approved')",[ops]);
  const legacy=crypto.randomUUID(),draft=crypto.randomUUID();
  await db.query("insert into incidents(id,reporter_id,title,description,category,latitude,longitude,submission_state) values($1,$2,'Synthetic','Private','water',0,0,'submitted'),($3,$2,'Draft','Private','water',0,0,'draft')",[legacy,citizen,draft]);
  await db.exec(await sql('012_citizen_accountability.sql'));ok(await count(legacy)===0);ok(await count(draft)===0);
  await actor(citizen);let result=(await db.query('select nigraan_read_accountability($1) as data',[legacy])).rows[0].data;ok(result.legacyHistory&&result.events.length===0);
  await rejects('insert into nigraan_incident_workflow_events(incident_id,kind,status) values($1,\'transition\',\'resolved\')',[legacy]);
  await rejects("insert into nigraan_operations_public_updates(incident_id,author_id,kind,message,request_id) values($1,$2,'progress','Fake',$3)",[legacy,ops,crypto.randomUUID()]);
  await rejects('select * from nigraan_incident_workflow_events');await rejects('select * from nigraan_operations_public_updates');
  await rejects("update nigraan_incident_workflow_events set status='resolved'");await rejects('delete from nigraan_operations_public_updates');
  await rejects('select nigraan_publish_public_update($1,$2,$3)',[legacy,'Fake',crypto.randomUUID()]);
  await actor(other);await rejects('select nigraan_read_accountability($1)',[legacy]);
  await actor('', 'anon');await rejects('select nigraan_read_accountability($1)',[legacy]);
  await actor(ops);await rejects('select nigraan_read_accountability($1)',[legacy]);
  await rejects('select nigraan_update_incident_status($1,$2,$3)',[legacy,'reported','resolved']);
  await db.exec('reset role');ok(await count(legacy)===0);
  await actor(ops);
  for(const [from,to] of [['reported','acknowledged'],['acknowledged','assigned'],['assigned','in_progress']]){await db.query('select nigraan_update_incident_status($1,$2,$3)',[legacy,from,to]);ok((await db.query('select status from incidents where id=$1',[legacy])).rows[0].status===to);}
  await db.exec('reset role');ok(await count(legacy)===3);
  const unchanged=async()=>{await db.exec('reset role');ok((await db.query('select status from incidents where id=$1',[legacy])).rows[0].status==='in_progress');ok(await count(legacy)===3);ok((await db.query("select count(*)::int as n from nigraan_operations_public_updates where incident_id=$1 and kind='resolution'",[legacy])).rows[0].n===0);};
  await actor(ops);await rejects('select nigraan_update_incident_status($1,$2,$3)',[legacy,'in_progress','resolved']);await unchanged();
  for(const who of [citizen,other]){await actor(who);await rejects('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'in_progress','Done',crypto.randomUUID()]);await unchanged();}
  await db.query("update incidents set description='Edit',updated_at=now() where id=$1",[legacy]);ok(await count(legacy)===3);
  await actor(ops);await rejects('select nigraan_update_incident_status($1,$2,$3)',[legacy,'assigned','in_progress']);
  await rejects('select nigraan_publish_public_update($1,$2,$3)',[crypto.randomUUID(),'Missing',crypto.randomUUID()]);
  await rejects('select nigraan_publish_public_update($1,$2,$3)',[draft,'Draft',crypto.randomUUID()]);
  for(const body of ['', ' ', 'x'.repeat(1001)])await rejects('select nigraan_publish_public_update($1,$2,$3)',[legacy,body,crypto.randomUUID()]);
  const retry=crypto.randomUUID();const published=(await db.query('select nigraan_publish_public_update($1,$2,$3) as id',[legacy,'Work review underway',retry])).rows[0].id;
  ok((await db.query('select nigraan_publish_public_update($1,$2,$3) as id',[legacy,'Work review underway',retry])).rows[0].id===published);
  await rejects('select nigraan_publish_public_update($1,$2,$3)',[legacy,'Different',retry]);
  await actor(citizen);result=(await db.query('select nigraan_read_accountability($1) as data',[legacy])).rows[0].data;ok(result.organization.name==='Safe Org');ok(result.updates[0].message==='Work review underway');
  const wire=JSON.stringify(result);ok(!wire.includes(ops)&&!wire.includes('author_id')&&!wire.includes('actor_id')&&!wire.includes('explanation')&&!wire.includes('storage_path'));
  await db.exec('reset role');await db.query("update operations_profiles set verification_status='pending' where user_id=$1",[ops]);
  await actor(citizen);ok((await db.query('select nigraan_read_accountability($1) as data',[legacy])).rows[0].data.organization===null);
  await actor(ops);await rejects('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'in_progress','Done',crypto.randomUUID()]);
  await db.exec('reset role');await db.query("update operations_profiles set verification_status='approved' where user_id=$1",[ops]);await actor(ops);
  for(const body of ['', ' ', 'x'.repeat(1001)]){await actor(ops);await rejects('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'in_progress',body,crypto.randomUUID()]);await unchanged();}await actor(ops);
  await rejects('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'assigned','Done',crypto.randomUUID()]);
  await db.exec('reset role');ok((await db.query('select status from incidents where id=$1',[legacy])).rows[0].status==='in_progress');ok(await count(legacy)===3);
  // Force publication failure after transition; the whole statement rolls back.
  await db.exec("alter table nigraan_operations_public_updates add constraint synthetic_failure check(message<>'FAIL')");await actor(ops);
  await rejects('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'in_progress','FAIL',crypto.randomUUID()]);await db.exec('reset role');ok(await count(legacy)===3);ok((await db.query('select status from incidents where id=$1',[legacy])).rows[0].status==='in_progress');
  await actor(ops);const resolution=crypto.randomUUID();await db.query('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'in_progress','Recorded resolution',resolution]);await db.query('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'in_progress','Recorded resolution',resolution]);
  await rejects('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'in_progress','Conflicting',resolution]);
  await rejects('select nigraan_resolve_with_message($1,$2,$3,$4)',[legacy,'in_progress','Work review underway',retry]);
  await rejects('select nigraan_publish_public_update($1,$2,$3)',[legacy,'After',crypto.randomUUID()]);
  await rejects('select nigraan_update_incident_status($1,$2,$3)',[legacy,'resolved','reported']);
  await db.exec('reset role');ok(await count(legacy)===4);ok((await db.query("select count(*)::int as n from nigraan_incident_workflow_events where incident_id=$1 and status='resolved'",[legacy])).rows[0].n===1);ok((await db.query("select count(*)::int as n from nigraan_operations_public_updates where incident_id=$1 and kind='resolution'",[legacy])).rows[0].n===1);
  await actor(citizen);result=(await db.query('select nigraan_read_accountability($1) as data',[legacy])).rows[0].data;ok(result.status==='resolved'&&result.updates[0].kind==='resolution');
  await rejects("select nigraan_begin_citizen_change($1,$2,'update',null,'No',$3)",[crypto.randomUUID(),legacy,new Date().toISOString()]);
  // Canonical finalizer requires real fixture Storage metadata and required photo.
  const fresh=crypto.randomUUID();await db.query('select nigraan_begin_incident($1,$2,$3,$4,$5,$6,$7,$8)',[fresh,'Fresh','Description','water','Area',0,0,1]);
  await rejects('select nigraan_finalize_incident($1,$2)',[fresh,'[]']);await db.exec('reset role');ok(await count(fresh)===0);
  const path=citizen+'/'+fresh+'/photo.jpg';await db.query("insert into storage.objects(bucket_id,name,metadata) values('incident-evidence',$1,$2)",[path,{mimetype:'image/jpeg',size:12}]);
  await actor(citizen);await rejects('select nigraan_finalize_incident($1,$2)',[fresh,JSON.stringify([{storage_path:path,source:'upload',transcription_job:crypto.randomUUID()}])]);await db.exec('reset role');ok(await count(fresh)===0);ok((await db.query('select submission_state from incidents where id=$1',[fresh])).rows[0].submission_state==='draft');
  await actor(citizen);await db.query('select nigraan_finalize_incident($1,$2)',[fresh,JSON.stringify([{storage_path:path,source:'upload'}])]);await db.query('select nigraan_finalize_incident($1,$2)',[fresh,'[]']);await db.exec('reset role');ok(await count(fresh)===1);
  await actor(citizen);result=(await db.query('select nigraan_read_accountability($1) as data',[fresh])).rows[0].data;ok(!result.legacyHistory&&result.events[0].status==='reported');
  console.log(`012 accountability security: ${checks} checks passed.`);
}finally{await db.close();}
