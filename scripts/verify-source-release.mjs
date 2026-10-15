// Local-only allowlist/secret-pattern checks. Never stages, commits or uploads.
import {readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {canonicalSourceSha256,HASH_CONTENT} from './hackathon-bootstrap.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../docs/source-release-manifest.json',import.meta.url),'utf8'));
assert.equal(manifest.commitAllowed,false);assert.equal(manifest.license.includeInCommit,false);
assert.equal(new Set(manifest.files).size,manifest.files.length);
assert.equal(manifest.hashContent,HASH_CONTENT);
assert.deepEqual(Object.keys(manifest.sha256).sort(),manifest.files.filter(path=>path!=='docs/source-release-manifest.json').sort(),'Exact hash inventory required');
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bAKIA[0-9A-Z]{16}\b/,/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,/\b(?:GOCSPX-|ghp_|github_pat_|sk_live_)[A-Za-z0-9_-]{20,}/,/\b1\/\/[A-Za-z0-9_-]{30,}/];
for(const path of manifest.files){
 const rel=relative(root,resolve(root,path));assert.ok(rel&&!rel.startsWith('..')&&!path.includes('\\'));
 assert.ok(!/(^|\/)(node_modules|dist|review|\.aws-sam|cleanup-prep)(\/|$)/.test(path));
 assert.ok(path!== 'LICENSE'&&(!path.startsWith('.env')||path==='.env.example'));
 assert.ok(!/dpapi|private_manifest|private_schema_review|rollback-artifact|acceptance-/i.test(path));
 const bytes=await readFile(resolve(root,path));const content=bytes.toString('utf8');
 if(path!=='docs/source-release-manifest.json'){
  assert.match(manifest.sha256[path],/^[a-f0-9]{64}$/);
  assert.equal(canonicalSourceSha256(bytes),manifest.sha256[path],'Reviewed source changed: '+path);
 }
 assert.ok(!patterns.some(p=>p.test(content)),'Possible secret in '+path+'; value suppressed');
 assert.ok(!/\bimport[^\n]*['"][^'"]*(?:cleanup-prep|review\/sql-check)[^'"]*['"]/.test(content),'Ignored local runtime import in '+path);
 assert.ok(content.split('\n').every(line=>!/[\t ]+$/.test(line)),'Trailing whitespace in '+path);
}
console.log('PASS: '+manifest.files.length+' allowlisted source files; no prohibited paths, high-confidence secret patterns, ignored-runtime imports or trailing whitespace. Pattern checks are not a complete security audit. LICENSE remains draft/excluded.');
