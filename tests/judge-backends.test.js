import test from 'node:test';
import assert from 'node:assert/strict';
import {createJudgeNotificationHandler,emailMessage} from '../supabase/functions/judge-notifications/handler.js';
import {createJudgeEvidenceHandler} from '../supabase/functions/judge-evidence/handler.js';
const id='00000000-0000-4000-8000-000000000001';
const job={id,lease:id,event:'requested',recipient:'synthetic@example.invalid',requested_at:'2026-10-12T00:00:00Z',expires_at:'2026-10-12T01:00:00Z'};
const settings={webhookSecret:'synthetic-webhook-secret-at-least-32-characters',clientId:'synthetic-client',clientSecret:'synthetic-secret',refreshToken:'synthetic-refresh',from:'nigraanos.admin@gmail.com'};
const webhook=secret=>new Request('http://localhost/worker',{method:'POST',headers:{'x-judge-webhook-secret':secret||''},body:JSON.stringify({schema:'public',table:'nigraan_judge_email_outbox',type:'INSERT',record:{id,state:'pending'}})});
test('request notification uses server-verified recipient and sign-in-only admin link',async()=>{
 let sent,finished;
 const handler=createJudgeNotificationHandler({config:()=>settings,claim:async()=>job,finish:async(...args)=>finished=args,fetcher:async(url,init)=>{if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic-access'});sent={url,...init};return Response.json({id:'synthetic-message'});}});
 assert.equal((await handler(webhook(settings.webhookSecret))).status,200);
 const raw=Buffer.from(JSON.parse(sent.body).raw,'base64url').toString();
 const message={to:[raw.match(/To: (.*)\r/)[1]],text:Buffer.from(raw.split('\r\n\r\n')[1].trim(),'base64').toString()};
 assert.deepEqual(message.to,['nigraanos.admin@gmail.com']);assert.match(message.text,/synthetic@example.invalid/);assert.match(message.text,/#\/judge-admin/);
 assert.equal(new Headers(sent.headers).get('Idempotency-Key'),null);assert.equal(finished[2],'synthetic-message');
});
test('legacy approval email preserves original UTC expiry and approval-start rule',()=>{
 const m=emailMessage({...job,event:'approved'},settings);
 assert.deepEqual(m.to,[job.recipient]);assert.match(m.text,/2026-10-12T01:00:00.000Z \(UTC\)/);assert.match(m.text,/not when you open/);
});
test('new approval email asks judge to activate within 48 hours without starting timer',()=>{
 const m=emailMessage({...job,event:'approved',expires_at:null,activation_expires_at:'2026-10-16T00:00:00Z'},settings);
 assert.match(m.text,/Start My 60-Minute Access/);assert.match(m.text,/2026-10-16T00:00:00.000Z/);
 assert.match(m.text,/only when activation succeeds/);assert.ok(!m.text.includes('Expires:'));
});
test('approval email without activation deadline is rejected before delivery',()=>{
 assert.throws(()=>emailMessage({...job,event:'approved',expires_at:null},settings));
});
test('rejection and revocation notifications grant no capability',()=>{
 for(const event of ['rejected','revoked']){const m=emailMessage({...job,event},settings);assert.match(m.text,/Citizen access remains available/);assert.ok(!m.text.includes('token='));}
});
test('wrong webhook secret cannot claim or send mail',async()=>{
 let claimed=false;const handler=createJudgeNotificationHandler({config:()=>settings,claim:async()=>{claimed=true;},finish:async()=>{}});
 assert.equal((await handler(webhook('incorrect'))).status,403);assert.equal(claimed,false);
});
test('duplicate webhook claim sends no duplicate email',async()=>{
 let calls=0;const handler=createJudgeNotificationHandler({config:()=>settings,claim:async()=>null,finish:async()=>{},fetcher:async()=>{calls++;}});
 assert.equal((await handler(webhook(settings.webhookSecret))).status,200);assert.equal(calls,0);
});
test('provider failure updates delivery only and logs no identities or secrets',async()=>{
 let finished,logged;const handler=createJudgeNotificationHandler({config:()=>settings,claim:async()=>job,finish:async(...args)=>finished=args,log:x=>logged=x,fetcher:async()=>new Response('synthetic failure',{status:429})});
 assert.equal((await handler(webhook(settings.webhookSecret))).status,503);assert.equal(finished[2],null);assert.equal(finished[3],'provider_failure');
 assert.deepEqual(logged,{event:'judge_email_failure',code:'provider_failure'});
});
test('configuration failure is recoverable without changing authorization',async()=>{
 let finished;const handler=createJudgeNotificationHandler({config:()=>({...settings,clientSecret:null}),claim:async()=>job,finish:async(...args)=>finished=args});
 assert.equal((await handler(webhook(settings.webhookSecret))).status,503);assert.equal(finished[3],'configuration');
});
const row={id,incident_id:id,uploader_id:id,storage_path:id+'/'+id+'/synthetic.jpg',mime_type:'image/jpeg',file_size:1};
const request=()=>new Request('http://localhost/evidence',{method:'POST',headers:{Authorization:'Bearer synthetic-token',Origin:'http://localhost'},body:JSON.stringify({evidence_id:id})});
function evidenceClient(allowed,rowValue=row){return {auth:{getUser:async()=>({data:{user:{id}}})},rpc:async()=>({data:{allowed:allowed(),permanent:true}}),from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:rowValue})})};}
test('evidence proxy serves exact authorized bytes without reusable URL',async()=>{
 const handler=createJudgeEvidenceHandler({allowedOrigins:()=> 'http://localhost',userClient:()=>evidenceClient(()=>true),download:async path=>{assert.equal(path,row.storage_path);return new Uint8Array([42]);}});
 const result=await handler(request());assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'no-store, private');assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[42]);
});
test('expiry while evidence downloads discards bytes',async()=>{
 let active=true;const handler=createJudgeEvidenceHandler({allowedOrigins:()=> 'http://localhost',userClient:()=>evidenceClient(()=>active),download:async()=>{active=false;return new Uint8Array([42]);}});
 assert.equal((await handler(request())).status,403);
});
test('evidence RLS denial prevents privileged download',async()=>{
 let downloaded=false;const handler=createJudgeEvidenceHandler({allowedOrigins:()=> 'http://localhost',userClient:()=>evidenceClient(()=>true,null),download:async()=>{downloaded=true;}});
 assert.equal((await handler(request())).status,403);assert.equal(downloaded,false);
});
test('malformed evidence path prevents privileged download',async()=>{
 let downloaded=false;const handler=createJudgeEvidenceHandler({allowedOrigins:()=> 'http://localhost',userClient:()=>evidenceClient(()=>true,{...row,storage_path:'other/private/path'}),download:async()=>{downloaded=true;}});
 assert.equal((await handler(request())).status,403);assert.equal(downloaded,false);
});
test('approved but unstarted judge cannot obtain evidence',async()=>{
 let downloaded=false;const client=evidenceClient(()=>true);client.rpc=async()=>({data:{allowed:true,permanent:false,status:'approved'}});
 const handler=createJudgeEvidenceHandler({allowedOrigins:()=> 'http://localhost',userClient:()=>client,download:async()=>{downloaded=true;}});
 assert.equal((await handler(request())).status,403);assert.equal(downloaded,false);
});


test('twelve-hour approval and renewal emails use their snapshot deadline, with no forced 48-hour claim',()=>{
 const m=emailMessage({...job,event:'approved',cycle:2,session_seconds:43200,expires_at:null,activation_expires_at:'2026-11-22T00:00:00Z'},settings);
 assert.match(m.text,/Start My 12-Hour Access/);
 assert.match(m.text,/2026-11-22T00:00:00.000Z/);
 assert.match(m.text,/only when activation succeeds/);
 assert.match(m.text,/Email is advisory/);
 assert.doesNotMatch(m.text,/within 48 hours|60-minute/);
 assert.throws(()=>emailMessage({...job,event:'approved',session_seconds:99999,expires_at:null,activation_expires_at:'2026-11-22T00:00:00Z'},settings));
});
