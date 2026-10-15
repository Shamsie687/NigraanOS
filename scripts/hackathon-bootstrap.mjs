import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const RELEASE='9b242aa1fb4d073acce007bcd654a603af810eda';
export const FORBIDDEN=['pmzbdrxedlthdqdpgigs','fnsshpaprqlshmmyavfh'];
export const FUNCTIONS=['city-context','nigraan-ai','transcribe-recording'];
export function projectRef(ref,confirmation){
  if(typeof ref!=='string'||!/^[a-z]{20}$/.test(ref)||FORBIDDEN.includes(ref))
    throw new Error('Supply a new 20-letter hackathon project ref; production/M4E are forbidden.');
  if(confirmation!==ref)throw new Error('Exact --confirm-project-ref must match --project-ref.');
  return ref;
}
export function databaseConfig(value,ref){
  const u=new URL(value);
  if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!==`db.${ref}.supabase.co`
    ||u.username!=='postgres'||!u.password||u.pathname!=='/postgres'
    ||(u.port&&u.port!=='5432')||u.search||u.hash)
    throw new Error('Require direct owner database URL for the confirmed project, port 5432, no URL options. Poolers unsupported.');
  return {PGHOST:u.hostname,PGPORT:'5432',PGDATABASE:'postgres',PGUSER:'postgres',
    PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'10'};
}
// Source manifests cover text files. Normalize CRLF only, byte-for-byte; do not
// decode UTF-8, trim whitespace, remove BOMs or normalize lone CR bytes.
export const HASH_CONTENT='git-lf-crlf-to-lf-v1';
export function canonicalSourceBytes(bytes){
  const input=Buffer.from(bytes),output=Buffer.allocUnsafe(input.length);
  let length=0;
  for(let i=0;i<input.length;i++){
    if(input[i]===13&&input[i+1]===10)continue;
    output[length++]=input[i];
  }
  return output.subarray(0,length);
}
export const canonicalSourceSha256=bytes=>createHash('sha256').update(canonicalSourceBytes(bytes)).digest('hex');
export function verifyIntegrity(root=ROOT,read=readFileSync){
  const manifest=JSON.parse(read(resolve(root,'supabase/hackathon/integrity.json')));
  if(manifest.hashContent!==HASH_CONTENT)throw new Error('Unsupported integrity hash content.');
  if(manifest.release!==RELEASE)throw new Error('Wrong approved release.');
  const expected=['supabase/hackathon/000_release_baseline.sql',
    ...['002_accounts_evidence_upgrade','003_fix_incident_categories','004_fix_evidence_constraints',
      '005_multi_workspace_access','006_voice_transcription','007_transcription_quota_tuning',
      '008_citizen_report_edits_updates','009_nigraan_ai','010_city_environment_context',
      '011_security_harden_legacy_access','012_citizen_accountability','013_citizen_around_me']
      .map(n=>`supabase/migrations/${n}.sql`)];
  if(JSON.stringify(manifest.sequence)!==JSON.stringify(expected))throw new Error('Migration sequence changed.');
  const functionFiles=['supabase/config.toml',...FUNCTIONS.flatMap(name=>{
    const files=name==='city-context'?['index.ts','handler.js','providers.js']:
      name==='nigraan-ai'?['index.ts','handler.js','context.js','responseValidation.js']:['index.ts','handler.js'];
    return files.map(f=>`supabase/functions/${name}/${f}`);
  })];
  const preparation=['scripts/hackathon-bootstrap.mjs','docs/hackathon-supabase-bootstrap.md','tests/hackathon-bootstrap.test.js'];
  const expectedFiles=[...expected,...functionFiles,...preparation].sort();
  if(JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify(expectedFiles))throw new Error('Integrity inventory changed.');
  for(const file of expectedFiles){
    if(!/^[a-f0-9]{64}$/.test(manifest.files[file])||canonicalSourceSha256(read(resolve(root,file)))!==manifest.files[file])throw new Error(`Source drift: ${file}`);
  }
  return manifest;
}
export function parseArgs(args){
  const [action,...tail]=args,options={};
  const values=['--project-ref','--confirm-project-ref','--migration','--function'];
  const switches=['--execute','--approve-reviewed-operation','--ack-new-empty-project'];
  for(let i=0;i<tail.length;i++){
    const name=tail[i];
    if(Object.hasOwn(options,name))throw new Error('Duplicate option.');
    if(values.includes(name)){
      if(!tail[i+1]||tail[i+1].startsWith('--'))throw new Error('Missing option value.');
      options[name]=tail[++i];
    }else if(switches.includes(name))options[name]=true;
    else throw new Error('Unknown option.');
  }
  if(!['verify','plan','apply-one','deploy-function'].includes(action))throw new Error('Unknown action.');
  return {action,options};
}
export function operation(args,env=process.env,root=ROOT){
  const {action,options:o}=parseArgs(args),manifest=verifyIntegrity(root);
  if(action==='verify'){
    if(Object.keys(o).length)throw new Error('verify accepts no options.');
    return {kind:'verify',sequence:manifest.sequence};
  }
  const ref=projectRef(o['--project-ref'],o['--confirm-project-ref']);
  if(action==='plan'){
    if(Object.keys(o).some(k=>!['--project-ref','--confirm-project-ref'].includes(k)))throw new Error('plan accepts only targeting options.');
    return {kind:'plan',project:ref,sequence:manifest.sequence,functions:FUNCTIONS};
  }
  if(!o['--execute']||!o['--approve-reviewed-operation'])throw new Error('Remote execution requires --execute AND --approve-reviewed-operation.');
  if(action==='apply-one'){
    if(o['--function']||!o['--ack-new-empty-project'])throw new Error('SQL requires --ack-new-empty-project and no function option.');
    const file=manifest.sequence.find(f=>f.split('/').at(-1).slice(0,3)===o['--migration']);
    if(!file)throw new Error('Choose one exact migration number from 000,002–013.');
    const db=databaseConfig(env.HACKATHON_DATABASE_URL,ref);
    // No linked CLI state, pooler URL, .env loading, or caller-supplied SQL path.
    const clean=Object.fromEntries(Object.entries(env).filter(([k])=>!/^PG/i.test(k)&&k!=='HACKATHON_DATABASE_URL'));
    return {kind:'remote',command:'psql',args:['-X','--set','ON_ERROR_STOP=1','--file',resolve(root,file)],
      env:{...clean,...db},cwd:root,project:ref};
  }
  if(o['--migration']||o['--ack-new-empty-project']||!FUNCTIONS.includes(o['--function']))throw new Error('Select one release function only.');
  // Explicit ref wins over links; strip inherited DB targeting and load no env file.
  const clean=Object.fromEntries(Object.entries(env).filter(([k])=>!/^PG/i.test(k)
    &&!['HACKATHON_DATABASE_URL','SUPABASE_DB_URL','SUPABASE_PROJECT_ID','SUPABASE_PROJECT_REF'].includes(k)));
  return {kind:'remote',command:'supabase',args:['functions','deploy',o['--function'],'--project-ref',ref,'--no-verify-jwt'],env:clean,cwd:root,project:ref};
}
export function main(args){
  const op=operation(args);
  if(op.kind!=='remote'){console.log(JSON.stringify(op,null,2));return;}
  console.log(`Explicitly confirmed operation targeting hackathon project ${op.project}.`);
  // Child output is intentionally not echoed: CLI diagnostics can contain secrets.
  const child=spawnSync(op.command,op.args,{cwd:op.cwd,env:op.env,encoding:'utf8',shell:false});
  if(child.error||child.status!==0)throw new Error('Operation failed. Stop; inspect privately. No retry or rollback performed.');
  console.log('Operation completed. Validate hosted state separately before continuing.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
