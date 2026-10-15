import test from 'node:test';
import assert from 'node:assert/strict';
import {sendGmail,gmailRaw} from '../supabase/functions/judge-notifications/gmail.js';
import {authorizationUrl,callbackCode,SCOPE,protectCredentials} from '../scripts/authorize-gmail.mjs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const settings={clientId:'synthetic-client',clientSecret:'synthetic-secret',refreshToken:'synthetic-refresh'};
const message={from:'nigraanos.admin@gmail.com',to:['synthetic@example.invalid'],subject:'Synthetic notification',text:'Synthetic UTF-8 ✓'};
test('Windows DPAPI encrypts and restores synthetic credentials without plaintext files',{skip:process.platform!=='win32'},async()=>{
 const plain=JSON.stringify({GMAIL_REFRESH_TOKEN:'synthetic-not-a-token'});
 const encrypted=await protectCredentials(plain);assert.ok(!encrypted.includes('synthetic'));
 const restored=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"],{input:encrypted,encoding:'utf8',windowsHide:true,env:{...process.env,PSModulePath:join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules')},stdio:['pipe','pipe','ignore']});
 assert.equal(restored,plain);
});
test('Gmail MIME preserves UTF-8 body and rejects header injection',()=>{
 const mime=Buffer.from(gmailRaw(message,'synthetic'),'base64url').toString();
 assert.equal(Buffer.from(mime.split('\r\n\r\n')[1].trim(),'base64').toString(),message.text);
 assert.throws(()=>gmailRaw({...message,to:['victim@example.invalid\r\nBcc: other@example.invalid']},'synthetic'));
 assert.throws(()=>gmailRaw({...message,from:'other@example.invalid'},'synthetic'));
});
test('refresh uses server credentials then sends through Gmail without idempotency fiction',async()=>{
 const calls=[];const result=await sendGmail(message,'synthetic',settings,async(url,init)=>{calls.push({url,init});return Response.json(calls.length===1?{access_token:'synthetic-access',scope:SCOPE}:{id:'synthetic-message'});});
 assert.equal(result,'synthetic-message');assert.equal(calls.length,2);
 assert.equal(new URLSearchParams(calls[0].init.body).get('grant_type'),'refresh_token');
 assert.equal(calls[1].init.headers.Authorization,'Bearer synthetic-access');
});
test('expired OAuth token, timeout and unexpected scopes prevent any send',async()=>{
 for(const value of ['invalid','timeout','scope']){let calls=0;
  await assert.rejects(sendGmail(message,'synthetic',settings,async()=>{calls++;if(value==='timeout')throw new Error('synthetic secret must never leak');return value==='invalid'?new Response('',{status:400}):Response.json({access_token:'synthetic',scope:'https://mail.google.com/'});}),e=>['configuration','provider_failure'].includes(e.safeCode));assert.equal(calls,1);
 }
});
test('Gmail explicit rejection is retryable but 5xx, timeout and malformed success are uncertain',async()=>{
 for(const value of [400,401,403,429,500,'timeout','malformed']){let calls=0;
  await assert.rejects(sendGmail(message,'synthetic',settings,async()=>{calls++;if(calls===1)return Response.json({access_token:'synthetic'});if(value==='timeout')throw new Error('timeout');return value==='malformed'?Response.json({}):new Response('',{status:value});}),e=>e.safeCode===([400,401,403,429].includes(value)?'provider_failure':'delivery_unknown'));assert.equal(calls,2);
 }
});
test('local OAuth uses send-only scope, offline access, state and S256 PKCE',()=>{
 const url=new URL(authorizationUrl('synthetic-client','http://127.0.0.1:1234/oauth2callback','synthetic-state','a'.repeat(43)));
 assert.equal(url.searchParams.get('scope'),SCOPE);assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('include_granted_scopes'),'false');
 assert.equal(callbackCode(new URL('http://localhost/oauth2callback?state=synthetic-state&code=synthetic-code'),'synthetic-state'),'synthetic-code');
 for(const query of ['state=wrong&code=x','state=synthetic-state&code=x&code=y','state=synthetic-state&error=access_denied'])assert.throws(()=>callbackCode(new URL('http://localhost/oauth2callback?'+query),'synthetic-state'));
});
