import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../review/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../supabase/migrations/010_city_environment_context.sql',import.meta.url),'utf8'));
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>db.query("insert into city_environment_cache(city_id,dataset,normalization_version) values('karachi','weather',1)"),/permission denied/);await assert.rejects(()=>db.query("select city_environment_claim('karachi','weather')"),/permission denied/);await db.exec('reset role');}
  await db.exec('set role service_role');
  const claim=async dataset=>(await db.query('select city_environment_claim($1,$2) c',['karachi',dataset])).rows[0].c;
  const finish=async(dataset,token,payload,retry=60)=>(await db.query('select city_environment_finish($1,$2,$3,$4,$5) done',['karachi',dataset,token,payload,retry])).rows[0].done;
  const concurrent=await Promise.all([claim('weather'),claim('weather')]);assert.equal(concurrent.filter(r=>r.lease).length,1);const lease=concurrent.find(r=>r.lease).lease;
  assert.equal(await finish('weather',crypto.randomUUID(),{test:'invalid'}),false);
  assert.equal(await finish('weather',lease,{test:'success'}),true);const fresh=await claim('weather');assert.equal(fresh.lease,null);assert.equal(fresh.payload.test,'success');
  assert.equal(Math.round((Date.parse(fresh.refresh_after)-Date.parse(fresh.fetched_at))/1000),900);
  const aq=await claim('air_quality');assert.ok(aq.lease);await finish('air_quality',aq.lease,{test:'AQ'});const aqFresh=await claim('air_quality');assert.equal(Math.round((Date.parse(aqFresh.refresh_after)-Date.parse(aqFresh.fetched_at))/1000),3600);
  await db.exec('reset role');await db.exec("update city_environment_cache set refresh_after=now()-interval '1 second' where dataset='weather'");await db.exec('set role service_role');
  const retry=await claim('weather');await finish('weather',retry.lease,null,120);const failed=await claim('weather');assert.equal(failed.payload.test,'success');assert.equal(failed.fetched_at,fresh.fetched_at);assert.equal(failed.lease,null);assert.ok(Date.parse(failed.retry_after)>Date.now());
  await db.exec('reset role');await db.exec("update city_environment_cache set retry_after=null,lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' where dataset='weather'");await db.exec('set role service_role');assert.ok((await claim('weather')).lease);
  await assert.rejects(()=>claim('unknown'),/Unsupported/);
  await db.exec('reset role');assert.equal((await db.query("select relrowsecurity from pg_class where relname='city_environment_cache'")).rows[0].relrowsecurity,true);
  console.log('010 passed: RLS/browser write/RPC denial, service-only cache RPCs, concurrent lease, token binding, independent TTLs, failed refresh preserves success, retry backoff and lease recovery.');
}finally{await db.close();}
