import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,grant,rpc,call,upstream} from './helpers.js';
import {clientFlow} from '../src/clientFlow.js';
test('judge MCP grant and incident references are capped at original judge deadline',async t=>{
 const h=await harness(t);h.state.accessExpiresAt=Date.now()+60000;
 const g=await grant(h);const record=await h.store.getGrant(g.access);
 assert.equal(record!.expiresAt,h.state.accessExpiresAt);
 let referenceExpiry=Infinity;const put=h.store.putReference.bind(h.store);
 h.store.putReference=async(context,reference)=>{referenceExpiry=reference.expiresAt;await put(context,reference);};
 const result=await rpc(h.origin,g.access,call('get_city_status'));
 assert.equal(result.res.status,200);
 assert.equal(referenceExpiry,h.state.accessExpiresAt);
 assert.ok(record!.expiresAt<Date.now()+600000);
});
test('existing delegated token cannot bypass judge expiry',async t=>{
 const h=await harness(t);h.state.accessExpiresAt=Date.now()+60000;
 const g=await grant(h);h.state.accessExpiresAt=Date.now()-1;
 const r=await rpc(h.origin,g.access,call('get_city_status'));
 assert.equal(r.res.status,403);assert.equal(await h.store.getGrant(g.access),undefined);
});
test('judge expiry between consent and token exchange prevents delegation',async t=>{
 const h=await harness(t);h.state.accessExpiresAt=Date.now()+60000;
 const flow=clientFlow(h.config),url=await h.delegation.start(Object.fromEntries(new URL(flow.authorizeUrl).searchParams));
 const transaction=new URLSearchParams(new URL(url).hash.split('?')[1]).get('transaction')!;
 const token=upstream();const details=await h.delegation.inspect(transaction,token);
 const decision=await h.delegation.decide({transaction,state:details.state,decision:'approve'},token);
 h.state.accessExpiresAt=Date.now()-1;
 await assert.rejects(()=>h.delegation.exchange(flow.consume(decision.redirect)));
});


test('twelve-hour Operations session still mints at most ten-minute MCP delegation',async t=>{
 const h=await harness(t);h.state.accessExpiresAt=Date.now()+43200000;
 const before=Date.now(),g=await grant(h),stored=await h.store.getGrant(g.access);
 assert.ok(stored&&stored.expiresAt<=Date.now()+600000&&stored.expiresAt>before);
 assert.ok(stored!.expiresAt<h.state.accessExpiresAt);
});
