// Local-only allowlist/secret-pattern checks. Never stages, commits or uploads.
import {readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {canonicalSourceSha256,HASH_CONTENT} from './hackathon-bootstrap.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../docs/source-release-manifest.json',import.meta.url),'utf8'));
const renewal=JSON.parse(await readFile(new URL('../docs/judge-renewal-release-manifest.json',import.meta.url),'utf8'));
assert.equal(manifest.commitAllowed,false);assert.equal(manifest.license.includeInCommit,false);
assert.equal(new Set(manifest.files).size,manifest.files.length);
assert.equal(manifest.hashContent,HASH_CONTENT);
assert.deepEqual(Object.keys(manifest.sha256).sort(),manifest.files.filter(path=>path!=='docs/source-release-manifest.json').sort(),'Exact hash inventory required');
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bAKIA[0-9A-Z]{16}\b/,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,/\b(?:GOCSPX-|ghp_|github_pat_|sk_live_)[A-Za-z0-9_-]{20,}/,/\b1\/\/[A-Za-z0-9_-]{30,}/];
const approvedRenewal=[
 'docs/HACKATHON_JUDGE_GUIDE.md','docs/source-release-manifest.json','server/mcp/src/supabaseAdapter.ts',
 'server/mcp/tests/adapter.test.ts','server/mcp/tests/judgeExpiredRegression.test.ts','server/mcp/tests/judgeExpiry.test.ts',
 'src/components/JudgeAccess.jsx','src/components/JudgeCountdown.jsx','src/pages/JudgeAdminPage.jsx','src/services/judgeAccess.js',
 'supabase/functions/judge-notifications/handler.js','tests/judge-access-render-check.mjs','tests/judge-access.test.js',
 'tests/judge-backends.test.js','tests/judge-native-postgres.mjs','docs/JUDGE_RENEWAL_POSTCHECK.sql',
 'docs/JUDGE_RENEWAL_PREFLIGHT.sql','docs/JUDGE_RENEWAL_ROLLOUT.md','supabase/migrations/020_judge_renewal_twelve_hour_sessions.sql',
 'tests/judge-renewal-migration-check.mjs','README.md','docs/SOURCE_RELEASE_SETUP.md','docs/nigraan-mcp-deployment.md',
 'docs/GMAIL_NOTIFICATION_SETUP.md','docs/JUDGE_PRODUCTION_DEPLOYMENT_RUNBOOK.md','docs/nigraan-agent-architecture.md',
 'docs/SOURCE_RELEASE_RECONCILIATION.md','scripts/verify-source-release.mjs','docs/judge-renewal-release-manifest.json',
];
assert.deepEqual([...renewal.files].sort(),approvedRenewal.sort(),'Renewal scope must remain exactly reviewed');
assert.equal(renewal.hashContent,HASH_CONTENT);
assert.equal(renewal.selfHashExcluded,'docs/judge-renewal-release-manifest.json');
assert.equal(new Set(renewal.files).size,29);
async function verifyHashes(record,excluded,read=path=>readFile(resolve(root,path))){
 assert.deepEqual(Object.keys(record.sha256).sort(),record.files.filter(path=>path!==excluded).sort(),'Exact hash inventory required');
 for(const path of record.files){
  if(path===excluded)continue;
  assert.match(record.sha256[path],/^[a-f0-9]{64}$/);
  assert.equal(canonicalSourceSha256(await read(path)),record.sha256[path],'Reviewed source changed: '+path);
 }
}
await verifyHashes(renewal,renewal.selfHashExcluded);
if(process.argv.includes('--self-test')){
 const fixture={files:['a.txt','manifest.json'],sha256:{'a.txt':canonicalSourceSha256(Buffer.from('line\n'))}};
 await verifyHashes(fixture,'manifest.json',async()=>Buffer.from('line\n'));
 await verifyHashes(fixture,'manifest.json',async()=>Buffer.from('line\r\n'));
 await assert.rejects(()=>verifyHashes(fixture,'manifest.json',async()=>Buffer.from('changed\n')));
 for(const hashes of [{},{...fixture.sha256,extra:'0'.repeat(64)},{'a.txt':'0'.repeat(64)}])await assert.rejects(()=>verifyHashes({...fixture,sha256:hashes},'manifest.json',async()=>Buffer.from('line\n')));
 console.log('PASS: renewal hash regression accepts LF/CRLF and rejects corruption, missing/extra/wrong hashes.');
}
for(const path of new Set([...manifest.files,...renewal.files])){
 const rel=relative(root,resolve(root,path));assert.ok(rel&&!rel.startsWith('..')&&!path.includes('\\'));
 assert.ok(!/(^|\/)(node_modules|dist|review|\.aws-sam|\.netlify|\.git|cleanup-prep)(\/|$)/.test(path));
 assert.ok(path!== 'LICENSE'&&(!path.startsWith('.env')||path==='.env.example'));
 assert.ok(!/dpapi|private_manifest|private_schema_review|rollback-artifact|acceptance-/i.test(path));
 const bytes=await readFile(resolve(root,path));const content=bytes.toString('utf8');
 if(manifest.files.includes(path)&&path!=='docs/source-release-manifest.json'){
  assert.match(manifest.sha256[path],/^[a-f0-9]{64}$/);
  assert.equal(canonicalSourceSha256(bytes),manifest.sha256[path],'Reviewed source changed: '+path);
 }
 assert.ok(!patterns.some(p=>p.test(content)),'Possible secret in '+path+'; value suppressed');
 assert.ok(!/\bimport[^\n]*['"][^'"]*(?:cleanup-prep|review\/sql-check)[^'"]*['"]/.test(content),'Ignored local runtime import in '+path);
 assert.ok(content.split('\n').every(line=>!/[\t ]+$/.test(line)),'Trailing whitespace in '+path);
}
const license=await readFile(resolve(root,'LICENSE'),'utf8');
assert.ok(license.startsWith('MIT License\n')||license.startsWith('MIT License\r\n'));
assert.ok(license.includes('Copyright (c) 2026 Shamsie687 and ALI-ARSALANN'));
const readme=await readFile(resolve(root,'README.md'),'utf8');
for(const name of ['Shamsie687','ALI-ARSALANN'])assert.ok(readme.includes('https://github.com/'+name));
assert.ok((await readFile(resolve(root,'public/THIRD_PARTY_NOTICES.txt'))).length>0);
console.log('PASS: '+manifest.files.length+' historical inventory files and '+renewal.files.length+' renewal inventory files; exact canonical hashes, path/secret-pattern/import/whitespace guards passed. MIT license, creator credits and third-party notices retained. Historical LICENSE exclusion describes the earlier proposal only. Pattern checks are not a complete security audit.');
