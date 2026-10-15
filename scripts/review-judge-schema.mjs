// Offline only. Never executes captured live SQL or prints definitions/private data.
import {readFile,realpath,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
export function tokens(source){
  // Preserve quoted literals/identifiers and every operator/parenthesis.
  const found=source.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|:=|::|<>|<=|>=|\S/g)||[];
  return found.filter(t=>!t.startsWith('--')&&!t.startsWith('/*')).map(t=>/^[A-Za-z_]/.test(t)?t.toLowerCase():t).join(' ');
}
function unwrap(value){
 if(Array.isArray(value)&&value.length===1)return unwrap(value[0]);
 if(value?.private_schema_review)return unwrap(value.private_schema_review);
 if(typeof value==='string')return unwrap(JSON.parse(value));
 if(value?.format!=='nigraan-judge-schema-review-v1')throw new Error('Unexpected capture format');return value;
}
export async function baseline(){
 const db=new PGlite();
 const fixture=await readFile(new URL('../tests/transcription-migration-check.mjs',import.meta.url),'utf8');
 const start=fixture.indexOf('await db.exec(`')+15,end=fixture.indexOf('`);',start);
 const synthetic='00000000-0000-4000-8000-000000000001';
 await db.exec(fixture.slice(start,end).replaceAll('${citizen}',synthetic).replaceAll('${other}','00000000-0000-4000-8000-000000000002'));
 for(const file of ['002_accounts_evidence_upgrade.sql','003_fix_incident_categories.sql','004_fix_evidence_constraints.sql','005_multi_workspace_access.sql','006_voice_transcription.sql','007_transcription_quota_tuning.sql','008_citizen_report_edits_updates.sql','009_nigraan_ai.sql','010_city_environment_context.sql','012_citizen_accountability.sql','013_citizen_around_me.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 return db;
}
export function assess(capture,expected){
 const results=[];const add=(check,pass,reason)=>results.push({check,status:pass?'COMPATIBLE':'BLOCKED',reason});
 const key=p=>p.schema+'.'+p.table+'.'+p.name;
 const relevant=expected.policies;
 for(const e of relevant){const matches=capture.policies.filter(p=>key(p)===key(e));const p=matches[0];add('POLICY_'+key(e),matches.length===1&&p.permissive===e.permissive&&p.command===e.command&&JSON.stringify([...p.roles].sort())===JSON.stringify([...e.roles].sort())&&tokens(p.using||'')===tokens(e.using||'')&&tokens(p.check||'')===tokens(e.check||''),'Exact parsed catalog expression/role/command/guard comparison; no parentheses or literals discarded.');}
 const expectedKeys=new Set(expected.policies.map(key));
 for(const p of capture.policies.filter(p=>!expectedKeys.has(key(p)))){
  const commands={r:['r'],a:['a'],w:['w'],d:['d'],'*':['r','a','w','d']}[p.command]||[];
  const guards=expected.policies.filter(g=>g.schema===p.schema&&g.table===p.table&&!g.permissive);
  const table=capture.tables.find(t=>t.schema===p.schema&&t.name===p.table);
  const guardSafe=commands.length>0&&commands.every(cmd=>guards.some(g=>g.command===cmd&&g.roles.includes('public')&&capture.policies.some(a=>key(a)===key(g)&&!a.permissive&&JSON.stringify([...a.roles].sort())===JSON.stringify([...g.roles].sort())&&tokens(a.using||'')===tokens(g.using||'')&&tokens(a.check||'')===tokens(g.check||''))));
  const noAnon=(table?.grants||[]).every(g=>!['PUBLIC','anon'].includes(g.role));
  const columnSafe=capture.columns.filter(c=>c.schema===p.schema&&c.table===p.table).every(c=>(c.column_grants||[]).every(g=>!['PUBLIC','anon'].includes(g.role)&&!(g.role==='authenticated'&&['INSERT','UPDATE'].includes(g.privilege)&&!(p.table==='profiles'&&g.privilege==='UPDATE'&&['display_name','phone','avatar_url'].includes(c.name)))));
  const tableWriteSafe=(table?.grants||[]).every(g=>!(g.role==='authenticated'&&['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER'].includes(g.privilege)));
  add('LEGACY_POLICY_'+key(p),p.permissive&&!!table?.rls&&guardSafe&&noAnon&&columnSafe&&tableWriteSafe&&capture.role_memberships.length===0,'Compatible only when unchanged PUBLIC restrictive guards constrain every command and table/column grants and role membership cannot bypass them. No legacy policy deleted or trusted by name.');
 }
 const around=capture.functions.filter(f=>f.name==='nigraan_around_me_build'&&f.schema==='public');const e=expected.functions.find(f=>f.name==='nigraan_around_me_build');
 add('FUNCTION_nigraan_around_me_build',around.length===1&&tokens(around[0].source)===tokens(e.source)&&around[0].signature===e.signature&&around[0].return_type===e.return_type&&around[0].security_definer===e.security_definer&&around[0].volatility===e.volatility&&JSON.stringify(around[0].argument_names)===JSON.stringify(e.argument_names)&&JSON.stringify(around[0].config)===JSON.stringify(e.config),'Whitespace/comment-only differences are ignored; literal values, operators, signatures and security remain exact. Genuine drift is not overwritten.');
 const timestamp=capture.functions.filter(f=>f.name==='handle_updated_at'&&f.schema==='public');
 const safeSources=['begin new.updated_at = now(); return new; end;','begin new.updated_at := now(); return new; end;','begin new.updated_at = current_timestamp; return new; end;'].map(tokens);
 const safeTimestamp=timestamp.length===1&&timestamp[0].return_type==='trigger'&&timestamp[0].signature===''&&!timestamp[0].security_definer&&safeSources.includes(tokens(timestamp[0].source));
 add('FUNCTION_handle_updated_at',safeTimestamp,'Only exact invoker timestamp assignment/return bodies are compatible; no dynamic SQL or authorization side effects.');
 for(const name of ['on_incident_updated','on_profile_updated']){const ts=capture.triggers.filter(t=>t.name===name);add('TRIGGER_'+name,safeTimestamp&&ts.length===1&&ts[0].schema==='public'&&ts[0].table===(name==='on_incident_updated'?'incidents':'profiles')&&ts[0].bits===19&&ts[0].enabled==='O'&&ts[0].function==='public.handle_updated_at'&&!/REFERENCING|WHEN|UPDATE OF/i.test(ts[0].definition),'Requires exact enabled BEFORE UPDATE row timestamp trigger with no unreviewed conditions/transition tables.');}
 const serviceDefault=capture.defaults.some(d=>d.owner==='postgres'&&['global','public'].includes(d.schema)&&d.kind==='f'&&d.role==='service_role'&&d.privilege==='EXECUTE');
 add('DEFAULT_PRIVILEGES',!serviceDefault,'If inherited service_role EXECUTE exists, local migration 017 is REQUIRED after 015/016; no global defaults changed.');
 return results;
}
async function main(){
 const self=process.argv[2]==='--selftest',prepare=process.argv[2]==='--prepare-preflight';let capture;
 if(!self&&!prepare){const file=await realpath(resolve(process.argv[2]||'')),repo=await realpath(new URL('..',import.meta.url));const rel=relative(repo,file);if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw new Error('Private capture must remain outside the repository');capture=unwrap(JSON.parse(await readFile(file,'utf8')));}
 const db=await baseline();
 try{
  const functions=(await db.query("select n.nspname schema,p.proname name,oidvectortypes(p.proargtypes) signature,format_type(p.prorettype,null) return_type,coalesce(p.proargnames,array[]::text[]) argument_names,p.prosecdef security_definer,p.provolatile volatility,coalesce(p.proconfig,array[]::text[]) config,p.prosrc source from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows;
  const policies=(await db.query("select schemaname schema,tablename \"table\",policyname name,permissive='PERMISSIVE' permissive,case cmd when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w' when 'DELETE' then 'd' else '*' end command,roles,qual \"using\",with_check \"check\" from pg_policies where schemaname in ('public','storage')")).rows;
  if(prepare){
   let sql=await readFile(new URL('../docs/JUDGE_PRODUCTION_SCHEMA_PREFLIGHT_V2.sql',import.meta.url),'utf8');
   const data=JSON.parse(sql.split('$expected$')[1]);
   for(const p of data.policies){const parsed=policies.find(x=>x.schema===p.schema&&x.table===p.table&&x.name===p.name);if(!parsed)throw new Error('Expected release policy absent');p.using=parsed.using||'';p.check=parsed.check||'';}
   sql=sql.replace(sql.split('$expected$')[1],JSON.stringify(data));
   const begin=sql.indexOf(' and replace(replace(regexp_replace(regexp_replace');const end=sql.indexOf('\n and (not e.falseguard',begin);
   if(begin<0||end<0)throw new Error('Preflight template changed');
   sql=sql.slice(0,begin)+` and coalesce(pg_get_expr(p.polqual,p.polrelid),'')=e."using" and coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')=e."check"`+sql.slice(end);
   // This removes unsafe parenthesis-stripping. Expected expressions come from
   // actual local PostgreSQL parsing of unchanged release migrations.
   await writeFile(new URL('../docs/JUDGE_PRODUCTION_SCHEMA_PREFLIGHT_V3.sql',import.meta.url),'-- V3: expected policy expressions compiled in isolated PostgreSQL, not handwritten normalization.\n-- Unknown live objects remain blocked until private consolidated capture is reviewed.\n'+sql);
   console.log('Prepared V3 from parsed release policy expressions. No live definitions embedded.');return;
  }
  if(self){
   const sample={functions,policies,tables:[],columns:[],triggers:[],defaults:[],role_memberships:[]};
   assert.ok(assess(sample,{functions,policies}).find(r=>r.check==='FUNCTION_nigraan_around_me_build').status==='COMPATIBLE');
   const changed=structuredClone(sample);changed.functions.find(f=>f.name==='nigraan_around_me_build').source+='\n perform unsafe();';assert.equal(assess(changed,{functions,policies}).find(r=>r.check==='FUNCTION_nigraan_around_me_build').status,'BLOCKED');
   assert.notEqual(tokens("select 'A'"),tokens("select 'a'"));assert.notEqual(tokens('a and (b or c)'),tokens('(a and b) or c'));
   const legacy=structuredClone(sample);
   legacy.policies.push({schema:'public',table:'profiles',name:'Synthetic legacy policy',permissive:true,command:'r',roles:['authenticated'],using:'true',check:null});
   legacy.tables.push({schema:'public',name:'profiles',rls:true,grants:[{role:'authenticated',privilege:'SELECT'}]});
   assert.equal(assess(legacy,{functions,policies}).find(r=>r.check.includes('Synthetic legacy policy')).status,'COMPATIBLE');
   legacy.policies.find(p=>p.name==='nigraan_profile_read_guard').using='true';
   assert.equal(assess(legacy,{functions,policies}).find(r=>r.check.includes('Synthetic legacy policy')).status,'BLOCKED');
   assert.equal(assess({...sample,defaults:[{owner:'postgres',schema:'public',kind:'f',role:'service_role',privilege:'EXECUTE'}]},{functions,policies}).find(r=>r.check==='DEFAULT_PRIVILEGES').status,'BLOCKED');
   const liveCheck=await readFile(new URL('../docs/JUDGE_PRODUCTION_SCHEMA_PREFLIGHT_V3.sql',import.meta.url),'utf8');
   const checked=await db.query(liveCheck);assert.equal(checked.rows.length,1);assert.ok(['PASS','BLOCKED'].includes(checked.rows[0].verdict));
   const diagnostic=await readFile(new URL('../docs/JUDGE_SCHEMA_CONSOLIDATED_DIAGNOSTIC.sql',import.meta.url),'utf8');
   const captured=await db.query(diagnostic);assert.equal(captured.rows[0].private_schema_review.format,'nigraan-judge-schema-review-v1');
   await db.exec('alter table auth.users add column email_confirmed_at timestamptz; alter default privileges for role postgres grant execute on functions to service_role;');
   for(const f of ['015_temporary_judge_access.sql','016_gmail_notification_retry_safety.sql','017_judge_rpc_service_role_hardening.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
   const rows=(await db.query("select p.proname name,has_function_privilege('service_role',p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('nigraan_request_judge_access','nigraan_decide_judge_access','nigraan_retry_judge_email','nigraan_claim_judge_email','nigraan_finish_judge_email')")).rows;
   assert.equal(rows.length,5);for(const r of rows)assert.equal(r.allowed,['nigraan_claim_judge_email','nigraan_finish_judge_email'].includes(r.name));
   console.log('PASS: 16 synthetic regression/privilege/output assertions; isolated PGlite only.');return;
  }
  const results=assess(capture,{functions,policies});
  const covered=new Set(['DEFAULT_PRIVILEGES','FUNCTION_nigraan_around_me_build','UNKNOWN_PUBLIC_FUNCTION_handle_updated_at','UNREVIEWED_TRIGGER_public.incidents.on_incident_updated','UNREVIEWED_TRIGGER_public.profiles.on_profile_updated']);
  const unexplained=capture.mismatches.filter(m=>!covered.has(m.check)&&!m.check.startsWith('POLICY_')&&!m.check.startsWith('UNKNOWN_POLICY_'));
  console.log(JSON.stringify({verdict:results.every(r=>r.status==='COMPATIBLE')&&unexplained.length===0?'COMPATIBLE_REVIEW_ONLY':'BLOCKED',results,additional_blocked_checks:unexplained.map(m=>m.check),note:'This is offline analysis of a captured snapshot, not a fresh live preflight or deployment approval. Do not share raw capture.'},null,2));
 }finally{await db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{const line=error?.stack?.match(/review-judge-schema\.mjs:(\d+):/)?.[1];console.error('BLOCKED: offline review failed. Safe diagnostic category: '+(error instanceof TypeError?'TypeError':error?.code==='ENOENT'?'FileNotFound':'ReviewError')+(line?' at reviewer line '+line:'')+'. No private definitions are printed.');process.exitCode=1;});
