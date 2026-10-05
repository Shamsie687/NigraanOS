import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentTools,validateToolInput,projectAgentConditions,TOOL_DEFINITIONS} from '../src/services/agentTools.js';
import {readFile} from 'node:fs/promises';
import {planAgentMessage,boundedThread} from '../src/utils/agentConversation.js';
const T=Date.parse('2026-10-05T12:00:00Z'),iso=t=>new Date(t).toISOString();
const row=(id,extra={})=>({id,category:'water',status:'reported',priority:'normal',reported_at:iso(T-1000),submission_state:'submitted',title:'Private Citizen title',description:'Private body',reporter_id:'private-citizen',latitude:24.8,storage_path:'private/file',...extra});
function fixture(options={}){
 const state={account:'operator',approved:true,rows:[row('private-uuid-a',{priority:'critical'}),row('private-uuid-b',{reported_at:iso(T-3*86400000),status:'assigned'})],events:[{id:'private-event',incident_id:'private-uuid-b',kind:'update',published_at:iso(T-20),submission_state:'published',body:'Private update'}],clock:T,calls:[],...options};
 const client={auth:{getUser:async()=>({data:{user:{id:state.account}}})},rpc:async name=>{state.calls.push(name);assert.equal(name,'is_approved_operations');return {data:state.approved};},functions:{invoke:async name=>{state.calls.push(name);assert.equal(name,'city-context');return {data:{version:1,context_only:true,city:{id:'karachi'},weather:{status:'current',temperature_c:25,valid_at:iso(T),fetched_at:iso(T),precipitation:{amount_mm:0,interval_seconds:900}},air_quality:{status:'stale',aqi:80,valid_at:iso(T),fetched_at:iso(T)}}};}},from(table){state.calls.push('read:'+table);let start=0,end=499,conditions={},ids=null,from=null,to=null,cols;const q={select(v){cols=v;return q;},eq(k,v){conditions[k]=v;return q;},in(k,v){ids=v;return q;},gte(k,v){from=v;return q;},lt(k,v){to=v;return q;},order(){return q;},range(a,b){start=a;end=b;return q;},abortSignal(){return q;},maybeSingle:async()=>{if(state.readFail)return {error:new Error('Sensitive raw error')};return {data:state.rows.find(r=>Object.entries(conditions).every(([k,v])=>r[k]===v))||null};},then(resolve){if(state.readFail||table==='nigraan_citizen_changes'&&state.activityFail)return Promise.resolve({error:new Error('Sensitive raw error')}).then(resolve);let rows=table==='incidents'?state.rows:state.events;rows=rows.filter(r=>Object.entries(conditions).every(([k,v])=>r[k]===v)&&(!ids||ids.includes(r.incident_id))&&(!from||r.published_at>=from)&&(!to||r.published_at<to));return Promise.resolve({data:rows.slice(start,Math.min(end+1,start+(state.rowCap||500))).map(r=>Object.fromEntries(cols.split(',').map(k=>[k,r[k]])))}).then(resolve);}};return q;}};
 const navigation=[];const tools=createAgentTools({client,accountId:'operator',now:()=>state.clock,onIncident:id=>navigation.push(['incident',id]),onView:view=>navigation.push(['view',view])});return {tools,state,navigation};
}
test('all seven stable tools and strict inputs',()=>{
 assert.equal(TOOL_DEFINITIONS.length,7);for(const [name,input] of [['bad',{}],['get_city_status',{sql:'select'}],['get_incident_details',{ref:'raw-uuid'}],['get_incident_details',{}],['navigate_to_view',{view:'Settings'}],['get_city_status',[]]])assert.throws(()=>validateToolInput(name,input));
});
for(const kind of ['citizen','unapproved','wrong-account'])test(kind+' rejected before data access',async()=>{
 const f=fixture(kind==='wrong-account'?{account:'another'}:{approved:false});await assert.rejects(()=>f.tools.run('get_city_status'),e=>e.code==='access');assert.ok(!f.state.calls.some(c=>c.startsWith('read:')));
});
test('status uses complete pagination and projected authorized facts only',async()=>{
 const f=fixture({rowCap:1});f.state.rows.push(row('draft',{submission_state:'draft'}));const r=await f.tools.run('get_city_status');assert.equal(r.facts.submitted,2);assert.equal(r.incidents[0].ref,'I1');const s=JSON.stringify(r);for(const privateText of ['private-uuid','Private','private-citizen','latitude','storage_path'])assert.ok(!s.includes(privateText));assert.equal(f.tools.resolveOrdinal(0),'I1');
});
test('urgent reuses criteria and includes normal old report with published update',async()=>{
 const f=fixture();const r=await f.tools.run('get_urgent_incidents');assert.equal(r.incidents.length,2);assert.deepEqual(r.incidents[0].reasons,['Recorded critical priority','New · Awaiting acknowledgement']);assert.equal(r.incidents[1].reasons[0],'Recent Citizen update');assert.equal(r.facts.recentlyCitizenUpdated,1);
});
test('activity failure reports partial eligibility, never invented zero',async()=>{
 const f=fixture({activityFail:true});const r=await f.tools.run('get_urgent_incidents');assert.equal(r.incidents.length,1);assert.equal(r.facts.recentlyCitizenUpdated,null);assert.match(r.notice,/unavailable/);
});
test('published activity output strips bodies/IDs and excludes drafts',async()=>{
 const f=fixture();f.state.events.push({...f.state.events[0],id:'draft',submission_state:'draft'});const r=await f.tools.run('get_incident_activity');assert.equal(r.activity.length,1);assert.equal(r.facts.publishedUpdates,1);assert.equal(r.incidents[0].ref,'I1');assert.ok(!JSON.stringify(r).includes('Private'));
});
test('follow-up resolves latest bounded order and re-reads detail',async()=>{
 const f=fixture();await f.tools.run('get_urgent_incidents');const plan=planAgentMessage('Tell me more about the first one.',f.tools);assert.deepEqual(plan,{tool:'get_incident_details',input:{ref:'I1'}});f.state.rows[0].status='acknowledged';const result=await f.tools.run(plan.tool,plan.input);assert.equal(result.incidents[0].status,'acknowledged');
});
test('unknown, expired and older-card references reject without guessing',async()=>{
 const f=fixture();assert.throws(()=>f.tools.resolveOrdinal(0));await f.tools.run('get_city_status');const version=f.tools.referenceVersion();await assert.rejects(()=>f.tools.run('get_incident_details',{ref:'I8'}));await f.tools.run('get_urgent_incidents');await assert.rejects(()=>f.tools.run('navigate_to_incident',{ref:'I1',referenceVersion:version}),e=>e.code==='stale_reference');f.state.clock+=300000;await assert.rejects(()=>f.tools.run('get_incident_details',{ref:'I1'}),e=>e.code==='stale_reference');assert.equal(f.navigation.length,0);
});
test('removed/unsubmitted incident and approval revocation clear references',async()=>{
 const f=fixture();await f.tools.run('get_city_status');f.state.rows[0].submission_state='draft';await assert.rejects(()=>f.tools.run('get_incident_details',{ref:'I1'}),e=>e.code==='stale_reference');await f.tools.run('get_city_status');f.state.approved=false;await assert.rejects(()=>f.tools.run('get_incident_details',{ref:'I1'}),e=>e.code==='access');assert.throws(()=>f.tools.resolveOrdinal(0));
});
test('navigation validates current incident and views, with no write RPC',async()=>{
 const f=fixture();await f.tools.run('get_city_status');await f.tools.run('navigate_to_incident',{ref:'I1'});await f.tools.run('navigate_to_view',{view:'Live Map'});assert.deepEqual(f.navigation,[['incident','private-uuid-a'],['view','Live Map']]);assert.ok(f.state.calls.every(c=>c==='is_approved_operations'||c.startsWith('read:')));
});
test('conditions stay CONTEXT with explicit modeled provenance and no coordinates/URLs',async()=>{
 const f=fixture();const r=await f.tools.run('get_city_conditions');assert.equal(r.kind,'CONTEXT');assert.equal(r.context.air.status,'stale');assert.equal(r.context.weather.precipitationMm,0);const safe=projectAgentConditions({weather:{source:{url:'https://private',grid_coordinates:[24,67]},status:'unavailable'},air_quality:{}});assert.ok(!JSON.stringify(safe).includes('https'));assert.equal(safe.air.status,'unavailable');
});
test('consequential commands never become tools; unsupported input explains limits',()=>{
 const f=fixture();for(const text of ['Resolve the first one','Assign I1','Change priority to critical','Dispatch responders','Delete report','Notify citizens','Mark it resolved'])assert.ok(planAgentMessage(text,f.tools).message);assert.ok(planAgentMessage('Predict disasters',f.tools).message);assert.equal(planAgentMessage('Open Analytics',f.tools).tool,'navigate_to_view');assert.equal(f.state.calls.length,0);
});
test('clear/close removes memory; thread stays bounded; read errors do not expose raw errors',async()=>{
 const f=fixture();await f.tools.run('get_city_status');f.tools.clear();assert.throws(()=>f.tools.resolveOrdinal(0));f.state.readFail=true;await assert.rejects(()=>f.tools.run('get_city_status'),e=>e.code==='read'&&!e.message.includes('Sensitive'));f.tools.close();await assert.rejects(()=>f.tools.run('get_city_status'),e=>e.code==='cancelled');assert.equal(boundedThread(Array.from({length:20},(_,id)=>({id})),{id:20}).length,20);
});
test('at most eight reference records; resolved excluded from urgent candidates',async()=>{
 const f=fixture({rows:Array.from({length:11},(_,n)=>row('private-'+n,{priority:'high',status:n===10?'resolved':'assigned'})),events:[]});const r=await f.tools.run('get_urgent_incidents');assert.equal(r.incidents.length,8);assert.equal(r.omitted,2);assert.equal(r.facts.recordedHigh,10);
});
test('cancelled request returns no data and mounted-account change is rejected',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(()=>f.tools.run('get_city_status',{},controller.signal),e=>e.code==='cancelled');assert.equal(f.state.calls.length,0);await f.tools.run('get_city_status');f.state.account='new-account';await assert.rejects(()=>f.tools.run('get_incident_details',{ref:'I1'}),e=>e.code==='access');assert.throws(()=>f.tools.resolveOrdinal(0));
});
test('Citizen app gate, no provider invocation or conversation persistence in Agent source',async()=>{
 const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');assert.ok(app.includes("route==='/operations' && hasOperationsAccess(auth.account)"));
 const hook=await readFile(new URL('../src/hooks/useNigraanAgent.js',import.meta.url),'utf8');for(const forbidden of ['localStorage','sessionStorage','invokeNigraanAi','GROQ_API_KEY'])assert.ok(!hook.includes(forbidden));assert.ok(hook.includes('controller.current?.abort()'));assert.ok(hook.includes('onAuthStateChange'));
});
