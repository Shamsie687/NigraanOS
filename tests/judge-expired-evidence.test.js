import test from 'node:test';
import assert from 'node:assert/strict';
import {createJudgeEvidenceHandler} from '../supabase/functions/judge-evidence/handler.js';
const id='00000000-0000-4000-8000-000000000001';
const request=()=>new Request('http://localhost/evidence',{method:'POST',headers:{Authorization:'Bearer synthetic-still-valid-auth-token'},body:JSON.stringify({evidence_id:id})});
test('valid Auth session with expired judge capability cannot query or download evidence',async()=>{
 let queried=false,downloaded=false;
 const handler=createJudgeEvidenceHandler({allowedOrigins:()=>'',userClient:()=>({auth:{getUser:async()=>({data:{user:{id}}})},rpc:async()=>({data:{allowed:false,permanent:false,status:'expired'}}),from(){queried=true;throw new Error('must not query');}}),download:async()=>{downloaded=true;return new Uint8Array([42]);}});
 assert.equal((await handler(request())).status,403);
 assert.equal(queried,false);assert.equal(downloaded,false);
});
test('temporary access expiring during an evidence download cannot return its bytes',async()=>{
 let active=true,calls=0;
 const client={auth:{getUser:async()=>({data:{user:{id}}})},rpc:async()=>{calls++;return {data:{allowed:active,permanent:false,status:active?'active':'expired'}};},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id,incident_id:id,uploader_id:id,storage_path:id+'/'+id+'/synthetic.jpg',mime_type:'image/jpeg',file_size:1}})})};
 const handler=createJudgeEvidenceHandler({allowedOrigins:()=>'',userClient:()=>client,download:async()=>{active=false;return new Uint8Array([42]);}});
 const result=await handler(request());assert.equal(result.status,403);assert.equal(calls,3);
 assert.ok(!(await result.text()).includes('synthetic.jpg'));
});
