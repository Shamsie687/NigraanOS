import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyTranscript,transcriptReducer,submissionTranscript} from '../src/utils/transcriptState.js';
import {transcribeRecording} from '../src/services/transcriptionClient.js';
import {submitIncident} from '../src/services/incidentSubmission.js';
import {createTranscriptionHandler,validateAudio} from '../supabase/functions/transcribe-recording/handler.js';
const uid='00000000-0000-4000-8000-000000000001';
const jid='00000000-0000-4000-8000-000000000002';
const iid='00000000-0000-4000-8000-000000000003';
const audio=new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3,1,2])],{type:'audio/webm;codecs=opus'});
const machine='یہاں پانی کھڑا ہے۔ Please send help.';
test('transcription state supports loading, failure, retry, Urdu editing/review, skip and re-record reset',()=>{
  let state=emptyTranscript();assert.equal(submissionTranscript(state).status,'not_connected');
  state=transcriptReducer(state,{type:'start'});assert.equal(state.status,'loading');
  state=transcriptReducer(state,{type:'failure',message:'Service unavailable'});assert.equal(submissionTranscript(state).status,'failed');
  state=transcriptReducer(state,{type:'start'});assert.equal(state.error,'');
  state=transcriptReducer(state,{type:'success',result:{text:machine,jobId:jid,detectedLanguage:'urdu'}});
  assert.deepEqual(submissionTranscript(state),{jobId:jid,text:machine,reviewed:false});
  state=transcriptReducer(state,{type:'edit',value:machine+' گلی نمبر ۲'});
  assert.equal(state.reviewed,true);assert.match(submissionTranscript(state).text,/گلی نمبر ۲/);
  state=transcriptReducer(state,{type:'review',value:false});assert.equal(submissionTranscript(state).reviewed,true);
  state=transcriptReducer(state,{type:'skip'});assert.equal(state.jobId,null);assert.equal(state.status,'skipped');
  state=transcriptReducer(state,{type:'reset'});assert.deepEqual(state,emptyTranscript());
});
test('client uses authenticated multipart invocation, preserves Unicode and never fabricates empty/error results',async()=>{
  const calls=[];
  const client={functions:{invoke:async(name,options)=>{calls.push({name,options});return {data:{jobId:jid,text:machine,detectedLanguage:'urdu'}};}}};
  assert.equal((await transcribeRecording(client,audio,'ur')).text,machine);
  assert.equal(calls[0].name,'transcribe-recording');assert.equal(calls[0].options.body.get('language'),'ur');
  client.functions.invoke=async()=>({data:{jobId:jid,text:''}});
  await assert.rejects(()=>transcribeRecording(client,audio),/No usable/);
  client.functions.invoke=async()=>({error:{context:new Response(JSON.stringify({error:'Provider is not configured'}))}});
  await assert.rejects(()=>transcribeRecording(client,audio),/not configured/);
});
function setup({authenticated=true,key='test-only-provider-key',rateLimited=false,rpcError=null,changeDraft=false,wrongChangeOwner=false,providerStatus=200,result={text:machine,language:'urdu',duration:12},fetchThrows=false}={}) {
  const calls=[];let row;
  const admin={rpc:async(name,args)=>{calls.push(['claim',name,args]);row={id:jid,user_id:uid,audio_sha256:args.audio_hash,status:'pending',expires_at:new Date(Date.now()+3600000).toISOString()};return rpcError?{error:rpcError}:rateLimited?{error:{code:'PT429',details:JSON.stringify({code:'app_quota_short',retry_after:60}),message:'Transcription limit reached'}}:{data:jid};},from:()=>{
    const filters=[];let values;
    const chain={select:()=>chain,gt:(key,value)=>{filters.push(['gt',key,value]);return chain;},eq:(key,value)=>{filters.push([key,value]);return chain;},is:()=>chain,update:input=>{values=input;return chain;},maybeSingle:async()=>({data:row}),then:(resolve,reject)=>Promise.resolve().then(()=>{calls.push(['db',values,filters]);Object.assign(row,values);return {data:[{id:jid}]};}).then(resolve,reject)};return chain;
  }};
  const userClient=()=>({auth:{getUser:async()=>authenticated?{data:{user:{id:uid}}}:{error:true}},
    from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:table==='profiles'?{id:uid,account_type:'operations'}:table==='nigraan_citizen_changes'?{id:iid,incident_id:iid,citizen_id:wrongChangeOwner?'another-user':uid,submission_state:'draft'}:changeDraft?null:{id:iid,reporter_id:uid,submission_state:'draft'}})})})}),
    storage:{from:()=>({download:async()=>({data:audio})})},
  });
  const handler=createTranscriptionHandler({providerKey:()=>key,allowedOrigins:()=>'http://127.0.0.1:5173',userClient,admin,fetcher:async(url,options)=>{
    calls.push(['provider',url,options]);if(fetchThrows)throw new Error('Network/private-provider-details');
    return new Response(JSON.stringify(result),{status:providerStatus});
  }});
  const request=(language='auto')=>{const body=new FormData();body.append('audio',audio,'voice.webm');body.append('language',language);return new Request('https://function.invalid',{method:'POST',headers:{Authorization:'Bearer local-test-user',Origin:'http://127.0.0.1:5173'},body});};
  return {handler,request,calls,getRow:()=>row};
}
test('server rejects unauthenticated/disallowed origins and missing secret before any provider call',async()=>{
  for(const options of [{authenticated:false},{key:''}]){const f=setup(options);assert.ok((await f.handler(f.request())).status>=400);assert.equal(f.calls.length,0);}
  const f=setup();const response=await f.handler(new Request('https://function.invalid',{method:'POST',headers:{Origin:'https://unapproved.invalid'}}));
  assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);assert.equal(f.calls.length,0);
});
test('server returns real provider text only, with receipt, timeout and selected/auto language behavior',async()=>{
  for(const language of ['auto','ur','en']){const f=setup();const response=await f.handler(f.request(language));assert.equal(response.status,200);
    assert.equal((await response.json()).text,machine);assert.equal(f.getRow().machine_text,machine);assert.equal(f.getRow().status,'ready');
    const sent=f.calls.find(call=>call[0]==='provider')[2];assert.equal(sent.body.get('model'),'whisper-large-v3');assert.equal(sent.body.get('language'),language==='auto'?null:language);assert.ok(sent.signal);
    const completion=f.calls.find(call=>call[0]==='db'&&call[1]?.status==='ready');assert.equal(completion[1].active_until,null);
    assert.ok(completion[2].some(filter=>filter[0]==='status'&&filter[1]==='pending'));
    assert.ok(completion[2].some(filter=>filter[0]==='gt'&&filter[1]==='active_until'));
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
});
test('server handles quotas, provider failures, silence, bad duration and network failure without inventing text',async()=>{
  for(const options of [{rateLimited:true},{providerStatus:429},{providerStatus:500},{result:{text:'',duration:3}},{result:{text:machine,duration:200}},{fetchThrows:true}]) {
    const f=setup(options);const response=await f.handler(f.request());assert.ok(response.status>=400);const body=await response.json();assert.equal(body.text,undefined);
    assert.ok(!body.error.includes('private-provider-details'));if(!options.rateLimited)assert.equal(f.getRow().status,'failed');
  }
});
test('server rejects fake container bytes, unsupported type, empty and oversized files',()=>{
  assert.throws(()=>validateAudio(new Uint8Array([1,2]),'audio/webm'));
  assert.throws(()=>validateAudio(new Uint8Array(),'audio/webm'));
  assert.throws(()=>validateAudio(new Uint8Array(10*1024*1024+1),'audio/webm'));
  assert.throws(()=>validateAudio(new Uint8Array([1]),'audio/wav'));
  validateAudio(new TextEncoder().encode('OggSbytes'),'audio/ogg');
  validateAudio(new Uint8Array([0,0,0,24,102,116,121,112]),'audio/mp4');
});
test('quota/busy/provider errors are distinct and quota rejection never calls Groq or creates another job',async()=>{
  for(const [code,status] of [['app_quota_short',429],['app_quota_daily',429],['transcription_busy',409]]) {
    const f=setup({rpcError:{code:status===409?'PT409':'PT429',details:JSON.stringify({code,retry_after:120}),message:'Internal quota detail'}});
    const response=await f.handler(f.request());assert.equal(response.status,status);assert.equal(response.headers.get('Retry-After'),'120');
    const data=await response.json();assert.equal(data.code,code);assert.equal(data.retryAfter,120);assert.ok(!data.error.includes('Internal'));
    assert.equal(f.calls.filter(call=>call[0]==='provider').length,0);assert.equal(f.calls.filter(call=>call[0]==='db').length,0);
  }
  const provider=setup({providerStatus:429});const response=await provider.handler(provider.request());assert.equal((await response.json()).code,'provider_rate_limited');
  const unrelated=setup({rpcError:{code:'P0001',message:'unrelated limit reached'}});const failed=await unrelated.handler(unrelated.request());assert.equal(failed.status,503);assert.equal((await failed.json()).code,undefined);
});
test('client displays approximate wait for structured quota errors without exposing technical details',async()=>{
  const client={functions:{invoke:async()=>({error:{context:new Response(JSON.stringify({error:'Try again shortly.',code:'app_quota_short',retryAfter:121}))}})}};
  await assert.rejects(()=>transcribeRecording(client,audio),/about 3 minute/);
});
test('receipt binding checks actual private audio hash and cannot bind a different recording or owner',async()=>{
  const f=setup();await f.handler(f.request());
  const binding=(path=uid+'/'+iid+'/'+jid+'.webm')=>new Request('https://function.invalid',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({action:'bind',jobId:jid,storagePath:path})});
  assert.equal((await f.handler(binding())).status,200);assert.equal(f.getRow().bound_path,uid+'/'+iid+'/'+jid+'.webm');
  f.getRow().audio_sha256='0'.repeat(64);assert.equal((await f.handler(binding())).status,400);
  assert.equal((await f.handler(binding('another-user/'+iid+'/'+jid+'.webm'))).status,403);
});
test('existing transcription binding accepts only self-owned private citizen-change drafts',async()=>{
  for(const wrongChangeOwner of [false,true]){const f=setup({changeDraft:true,wrongChangeOwner});await f.handler(f.request());
    const response=await f.handler(new Request('https://function.invalid',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({action:'bind',jobId:jid,storagePath:uid+'/'+iid+'/'+iid+'/'+jid+'.webm'})}));
    assert.equal(response.status,wrongChangeOwner?403:200);
  }
});
function submissionClient({bindingFails=false}={}){
  const calls=[];
  return {calls,functions:{invoke:async(name,{body})=>{calls.push(['bind',body]);return bindingFails?{error:{}}:{data:{bound:true}};}},
    rpc:async(name,args)=>{calls.push([name,args]);return {data:args.incident||args.incident_id};},
    storage:{from:()=>({upload:async path=>{calls.push(['upload',path]);return {};},remove:async paths=>{calls.push(['remove',paths]);return {};}})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{submission_state:'draft'}})})})})};
}
const photo={file:new Blob(['photo'],{type:'image/jpeg'}),source:'upload'};
test('report with reviewed transcript binds uploaded audio before atomic finalize; no transcript remains optional',async()=>{
  for(const transcription of [null,{status:'failed'},{jobId:jid,text:machine,reviewed:true}]){
    const client=submissionClient();await submitIncident(client,{},[photo,{file:audio,source:'recording',transcription}],uid);
    const record=client.calls.find(call=>call[0]==='nigraan_finalize_incident')[1].attachments[1];
    if(transcription?.jobId){assert.equal(record.transcript,machine);assert.equal(record.transcript_reviewed,true);assert.equal(client.calls.filter(call=>call[0]==='bind').length,1);}
    else{assert.equal(record.transcript,undefined);assert.equal(client.calls.filter(call=>call[0]==='bind').length,0);}
  }
});
test('binding failure cleans newly uploaded files and draft, allowing user to keep local recording and retry audio-only',async()=>{
  const client=submissionClient({bindingFails:true});
  await assert.rejects(()=>submitIncident(client,{},[photo,{file:audio,source:'recording',transcription:{jobId:jid,text:machine}}],uid));
  assert.equal(client.calls.find(call=>call[0]==='remove')[1].length,2);
  assert.ok(client.calls.some(call=>call[0]==='nigraan_abandon_draft'));assert.ok(!client.calls.some(call=>call[0]==='nigraan_finalize_incident'));
});
