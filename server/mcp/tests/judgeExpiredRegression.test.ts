import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures,harness,grant,rpc,call} from './helpers.js';
import {runTool} from '../src/tools.js';
import {names} from '../src/schemas.js';
import {MemoryStore,type Grant} from '../src/state.js';
import {Delegation} from '../src/oauth.js';
import {supabaseFactory} from '../src/supabaseAdapter.js';
const capability=(expiresAt:number):Grant=>({userId:'owner',clientId:'synthetic-client',grantId:'synthetic-grant',upstream:'synthetic-token',expiresAt,resource:'http://localhost/mcp',scope:'nigraan:read'});

test('all five tools reject at the delegated deadline even with a stale approved caller',async()=>{
 const clock=1800000000000,store=new MemoryStore(()=>clock),f=fixtures();
 try{for(const name of names){
  await assert.rejects(()=>runTool(name,name==='get_incident_details'?{context:'A'.repeat(43),ref:'I1'}:{},f.factory('synthetic-token'),capability(clock),store,new AbortController().signal,()=>clock),e=>(e as {code:string}).code==='invalid_token');
 }assert.equal(f.state.authorizationCalls,0);assert.equal(f.state.pageCalls,0);}finally{store.close();}
});

test('expiry during a tool read discards results before reference creation',async()=>{
 let clock=1800000000000;const expiry=clock+1000,store=new MemoryStore(()=>clock),f=fixtures(),caller=f.factory('synthetic-token');
 caller.incidents=async()=>{clock=expiry;return [];};
 let references=0;store.putReference=async()=>{references++;};
 try{await assert.rejects(()=>runTool('get_city_status',{},caller,capability(expiry),store,new AbortController().signal,()=>clock),e=>(e as {code:string}).code==='invalid_token');assert.equal(references,0);}finally{store.close();}
});

test('stored references cannot survive their original expiry under a newer grant',async()=>{
 let clock=1800000000000;const store=new MemoryStore(()=>clock),g=capability(clock+10000),context='A'.repeat(43);
 try{await store.putReference(context,{userId:g.userId,clientId:g.clientId,grantId:g.grantId,expiresAt:clock+1000,mapping:{I1:'synthetic-incident'}});
  clock+=1000;await assert.rejects(()=>store.resolveReference(context,'I1',g));
 }finally{store.close();}
});

test('stale delegated HTTP token cannot run any tool after database access ends',async t=>{
 const h=await harness(t);h.state.accessExpiresAt=Date.now()+60000;const g=await grant(h);
 h.state.approved=false;
 for(const name of names){const result=await rpc(h.origin,g.access,call(name,name==='get_incident_details'?{context:'A'.repeat(43),ref:'I1'}:{}));assert.ok([401,403].includes(result.res.status));}
 assert.equal(h.state.pageCalls,0);assert.equal(await h.store.getGrant(g.access),undefined);
});

test('actual adapter rejects expired database access despite a valid Auth identity',async()=>{
 const caller=supabaseFactory('https://test.supabase.co','sb_publishable_test',async input=>Response.json(String(input).includes('/auth/v1/user')?{id:'owner',aud:'authenticated',role:'authenticated'}:String(input).includes('nigraan_operations_access_context')?{allowed:false,permanent:false,status:'expired'}:false))('synthetic-still-valid-auth-token');
 await assert.rejects(()=>caller.authorize('owner'),e=>(e as {code:string}).code==='access_denied');
 await assert.rejects(()=>caller.accessDeadline!(),e=>(e as {code:string}).code==='access_denied');
});


test('renewed database access cannot revive expired MCP bearer or old reference context',async()=>{
 let clock=1800000000000;const store=new MemoryStore(()=>clock),f=fixtures();
 const config={origin:'https://mcp.example.test',clientId:'synthetic-client',clientName:'Synthetic',consentUrl:'https://app.example.test',redirectUri:'https://app.example.test/callback'};
 const broker=new Delegation(config,store,f.factory,()=>clock);
 const old={...capability(clock+1000),resource:config.origin+'/mcp'};
 try{
  await store.putGrant('old-token',old);
  await store.putReference('A'.repeat(43),{userId:old.userId,clientId:old.clientId,grantId:old.grantId,expiresAt:old.expiresAt,mapping:{I1:'synthetic-incident'}});
  clock=old.expiresAt;f.state.accessExpiresAt=clock+43200000;f.state.approved=true;
  await assert.rejects(()=>broker.resolve('old-token'),e=>(e as {code:string}).code==='invalid_token');
  const fresh={...old,grantId:'new-cycle-grant',expiresAt:clock+600000};await store.putGrant('fresh-token',fresh);
  assert.equal((await broker.resolve('fresh-token')).grantId,'new-cycle-grant');
  await assert.rejects(()=>store.resolveReference('A'.repeat(43),'I1',fresh));
 }finally{store.close();}
});
