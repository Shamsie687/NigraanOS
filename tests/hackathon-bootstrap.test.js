import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonicalSourceBytes,canonicalSourceSha256,HASH_CONTENT,ROOT,RELEASE,FORBIDDEN,FUNCTIONS,projectRef,databaseConfig,verifyIntegrity,operation} from '../scripts/hackathon-bootstrap.mjs';
const ref='abcdefghijklmnopqrst',target=['--project-ref',ref,'--confirm-project-ref',ref];
const approvals=['--execute','--approve-reviewed-operation','--ack-new-empty-project'];
const env={PATH:process.env.PATH,HACKATHON_DATABASE_URL:`postgresql://postgres:TEST_ONLY@db.${ref}.supabase.co:5432/postgres`};
test('bootstrap integrity and exact 000 then 002–013 order exclude historical 001 and privacy 014',()=>{
  const m=verifyIntegrity();assert.equal(m.sequence.length,13);
  assert.deepEqual(m.sequence.map(f=>f.split('/').at(-1).slice(0,3)),['000',...Array.from({length:12},(_,i)=>String(i+2).padStart(3,'0'))]);
  assert.deepEqual(FUNCTIONS,['city-context','nigraan-ai','transcribe-recording']);
});
test('release migrations and functions still match approved commit, ignoring checkout line endings',()=>{
  const m=verifyIntegrity();
  for(const f of Object.keys(m.files).filter(f=>f.startsWith('supabase/migrations/')||f.startsWith('supabase/functions/')||f==='supabase/config.toml')){
    const base=spawnSync('git',['show',`${RELEASE}:${f}`],{cwd:ROOT,encoding:'utf8',shell:false});
    assert.equal(base.status,0,f);
    const current=readFileSync(resolve(ROOT,f),'utf8').replaceAll('\r\n','\n');
    if(f==='supabase/config.toml'){
      assert.ok(current.startsWith(base.stdout.replaceAll('\r\n','\n')));
      assert.match(current,/\[functions\.judge-evidence\][\s\S]*verify_jwt = false/);
      assert.match(current,/\[functions\.judge-notifications\][\s\S]*verify_jwt = false/);
    }else assert.equal(current,base.stdout.replaceAll('\r\n','\n'),f);
  }
});
test('protected projects are rejected even with matching confirmation',()=>{
  for(const blocked of FORBIDDEN){
    assert.throws(()=>projectRef(blocked,blocked),/forbidden/);
    for(const action of ['plan','apply-one','deploy-function'])assert.throws(()=>operation([action,'--project-ref',blocked,'--confirm-project-ref',blocked]),/forbidden/);
  }
});
test('missing, mismatched, URL, uppercase and injection project targets fail closed',()=>{
  for(const bad of [undefined,'',ref.toUpperCase(),`https://${ref}.supabase.co`,ref+';whoami','../'+ref])assert.throws(()=>projectRef(bad,bad));
  assert.throws(()=>projectRef(ref,'other'),/match/);assert.throws(()=>projectRef(ref,undefined),/match/);
});
test('verify and confirmed plan remain local and contain no executable operation',()=>{
  assert.equal(operation(['verify']).kind,'verify');
  const plan=operation(['plan',...target]);assert.equal(plan.kind,'plan');assert.equal(plan.command,undefined);
  assert.throws(()=>operation(['plan',...target,'--execute']));
});
test('unknown/duplicate options and actions cannot bypass gating',()=>{
  for(const args of [['link',...target],['plan',...target,'--db-url','evil'],['plan',...target,'--project-ref',ref],['verify',...target]])assert.throws(()=>operation(args));
});
test('remote operations require both execution and reviewed-operation acknowledgment',()=>{
  for(const flags of [[],['--execute'],['--approve-reviewed-operation']])assert.throws(()=>operation(['apply-one',...target,...flags,'--migration','000'],env),/requires/);
});
test('SQL plan only accepts manifest migration IDs and requires fresh-project acknowledgment',()=>{
  assert.throws(()=>operation(['apply-one',...target,'--execute','--approve-reviewed-operation','--migration','000'],env));
  for(const id of ['001','014','../014','000;whoami','002_accounts_evidence_upgrade.sql'])assert.throws(()=>operation(['apply-one',...target,...approvals,'--migration',id],env));
  const op=operation(['apply-one',...target,...approvals,'--migration','000'],{...env,PGSERVICE:'production',PGOPTIONS:'host=production'});
  assert.equal(op.command,'psql');assert.ok(op.args.includes('--file'));assert.ok(op.args.at(-1).endsWith('000_release_baseline.sql'));
  assert.equal(op.env.PGHOST,`db.${ref}.supabase.co`);assert.equal(op.env.PGSSLMODE,'verify-full');assert.equal(op.env.PGSERVICE,undefined);assert.equal(op.env.PGOPTIONS,undefined);
  assert.ok(!op.args.join(' ').includes('TEST_ONLY'));assert.equal(op.env.HACKATHON_DATABASE_URL,undefined);
});
test('database hostname must match confirmed new project; poolers and options are refused',()=>{
  for(const url of [undefined,...FORBIDDEN.map(f=>`postgresql://postgres:TEST_ONLY@db.${f}.supabase.co/postgres`),
    `postgresql://postgres:TEST_ONLY@db.${ref}.supabase.co.evil/postgres`,
    `postgresql://postgres:TEST_ONLY@127.0.0.1/postgres`,
    `postgresql://postgres.${ref}:TEST_ONLY@pooler.supabase.com/postgres`,
    env.HACKATHON_DATABASE_URL+'?sslmode=disable',env.HACKATHON_DATABASE_URL.replace('postgres:TEST_ONLY','service_role:TEST_ONLY')])assert.throws(()=>databaseConfig(url,ref));
});
test('deployment uses explicit ref and only the three approved release functions',()=>{
  const op=operation(['deploy-function',...target,'--execute','--approve-reviewed-operation','--function','city-context'],env);
  assert.equal(op.command,'supabase');assert.deepEqual(op.args,['functions','deploy','city-context','--project-ref',ref,'--no-verify-jwt']);
  for(const name of ['evidence-upload','privacy-cleanup','../city-context','city-context;whoami'])assert.throws(()=>operation(['deploy-function',...target,'--execute','--approve-reviewed-operation','--function',name],env));
});
test('integrity rejects source corruption and reordered migration manifests',()=>{
  assert.throws(()=>verifyIntegrity(ROOT,path=>path.endsWith('000_release_baseline.sql')?Buffer.from('corrupt'):readFileSync(path)),/Source drift/);
  assert.throws(()=>verifyIntegrity(ROOT,path=>{
    const bytes=readFileSync(path);if(!path.endsWith('integrity.json'))return bytes;
    const m=JSON.parse(bytes);[m.sequence[1],m.sequence[2]]=[m.sequence[2],m.sequence[1]];return Buffer.from(JSON.stringify(m));
  }),/sequence/);
});
test('baseline fails closed on existing state and preserves managed Auth/Storage and release signup ownership',()=>{
  const sql=readFileSync(resolve(ROOT,'supabase/hackathon/000_release_baseline.sql'),'utf8');
  for(const text of ["current_user <> 'postgres'","Public schema must be empty","exists(select 1 from auth.users)","exists(select 1 from storage.buckets)",'enable row level security','alter default privileges','reports(id bigint generated always as identity'])assert.ok(sql.includes(text),text);
  assert.ok(!/create\s+(?:table|schema)\s+(?:auth|storage)[.\s]/i.test(sql));
  assert.deepEqual([...sql.matchAll(/create\s+trigger\s+(\w+)/gi)].map(m=>m[1]).sort(),['on_incident_updated','on_profile_updated']);
  assert.match(sql,/language plpgsql security invoker set search_path=pg_catalog/);
  assert.ok(!/create\s+(?:constraint\s+)?trigger[^;]*on\s+(?:auth|storage)\./i.test(sql));
});
test('baseline title/description bounds match approved incident RPC instead of imposing stricter legacy minima',()=>{
  const sql=readFileSync(resolve(ROOT,'supabase/hackathon/000_release_baseline.sql'),'utf8');
  const rpc=readFileSync(resolve(ROOT,'supabase/migrations/005_multi_workspace_access.sql'),'utf8');
  for(const field of ['title','description']){
    const limits=rpc.match(new RegExp(`length\\(trim\\(incident_${field}\\)\\) not between (\\d+) and (\\d+)`));
    assert.ok(limits,field);assert.ok(sql.includes(`check(length(trim(${field})) between ${limits[1]} and ${limits[2]})`),field);
  }
});


test('canonical source hashes preserve every byte except CRLF normalization',()=>{
  const lf=Buffer.from('Unicode: \u0627\nnext\n');
  assert.equal(canonicalSourceSha256(lf),canonicalSourceSha256(Buffer.from(lf.toString().replaceAll('\n','\r\n'))));
  for(const changed of [Buffer.concat([lf,Buffer.from(' ')]),Buffer.concat([lf,Buffer.from([13])]),Buffer.concat([Buffer.from([239,187,191]),lf])]){
    assert.notEqual(canonicalSourceSha256(lf),canonicalSourceSha256(changed));
  }
  assert.deepEqual(canonicalSourceBytes(Buffer.from([255,13,10,254,13])),Buffer.from([255,10,254,13]));
});

test('bootstrap accepts LF and CRLF checkouts but rejects missing hashes and unsupported normalization',()=>{
  for(const ending of ['\n','\r\n'])verifyIntegrity(ROOT,path=>Buffer.from(readFileSync(path,'utf8').replaceAll('\r\n','\n').replaceAll('\n',ending)));
  for(const mutate of [m=>delete m.files[m.sequence[0]],m=>m.hashContent='raw-bytes',m=>m.files[m.sequence[0]]='0'.repeat(64)]){
    assert.throws(()=>verifyIntegrity(ROOT,path=>{
      const bytes=readFileSync(path);if(!path.endsWith('integrity.json'))return bytes;
      const m=JSON.parse(bytes);assert.equal(m.hashContent,HASH_CONTENT);mutate(m);return Buffer.from(JSON.stringify(m));
    }));
  }
});
