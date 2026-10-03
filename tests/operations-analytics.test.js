import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DAY,analyticsWindow,calculateAnalytics,categoryComparison,timeline} from '../src/utils/operationsAnalytics.js';
import {fetchAnalyticsActivity,analyticsActivityColumns} from '../src/services/analyticsActivity.js';
const T=Date.parse('2026-10-03T12:00:00Z'),iso=t=>new Date(t).toISOString();
const incident=(id,at,extra={})=>({id,title:'Stored title',reported_at:typeof at==='number'?iso(at):at,status:'reported',priority:'normal',category:'traffic',submission_state:'submitted',...extra});
for(const [period,width] of [['24h',DAY],['7d',7*DAY],['30d',30*DAY]])test(period+' uses exact [T-W,T) cohort boundaries',()=>{
  const result=calculateAnalytics([incident('start',T-width),incident('before',T-width-1),incident('end',T),incident('inside',T-1),incident('future',T+1),incident('invalid','bad')],[],period,T);
  assert.equal(result.total,2);assert.equal(result.invalidDates,2);assert.equal(result.timeline.reduce((n,b)=>n+b.count,0),2);
});
test('All includes malformed/future dates in counts but excludes them from time charts and age ordering',()=>{
  const result=calculateAnalytics([incident('a',null),incident('b','bad'),incident('c',T+DAY),incident('d',T-DAY),incident('draft',T-DAY,{submission_state:'draft'})],[],'all',T);
  assert.equal(result.total,4);assert.equal(result.invalidDates,3);assert.equal(result.timeline.reduce((n,b)=>n+b.count,0),1);assert.equal(result.ageBands.at(-1).count,3);assert.deepEqual(result.oldest.map(i=>i.id),['d']);assert.equal(result.comparison,null);
});
test('current workflow, priority, categories and legacy values retain every cohort record',()=>{
  const rows=[incident('a',T-1),incident('b',T-2,{status:'resolved',priority:'critical',category:'water'}),incident('c',T-3,{status:null,priority:'urgent',category:'legacy'}),incident('d',T-4,{status:'in_progress',priority:'low',category:'flood'})];const r=calculateAnalytics(rows,[],'24h',T);
  assert.deepEqual([r.total,r.unresolved,r.resolved],[4,3,1]);for(const field of ['category','status','priority'])assert.equal(r[field].find(i=>i.key==='unknown').count,1);assert.equal(r.priority.find(i=>i.key==='normal').count,1);
});
test('timeline uses readable 4-hour/daily/grouped-day intervals with zero buckets only inside actual window',()=>{
  for(const [period,length] of [['24h',6],['7d',7],['30d',6]]){const w=analyticsWindow(period,T),bins=timeline([incident('a',w.from),incident('b',w.from+3600000),incident('end',T)],w);assert.equal(bins.length,length);assert.equal(bins[0].from,w.from);assert.equal(bins.at(-1).to,T);assert.equal(bins.reduce((n,b)=>n+b.count,0),2);}
  assert.deepEqual(timeline([],analyticsWindow('all',T)),[]);
  for(const days of [1,45,250,1000]){const bins=timeline([incident('a',T-days*DAY)],analyticsWindow('all',T));assert.ok(bins.length<=31);assert.equal(bins[0].from,T-days*DAY);assert.equal(bins.at(-1).to,T);assert.equal(bins.reduce((n,b)=>n+b.count,0),1);}
});
test('backlog spans all periods; bands and oldest IDs use report start, never updated_at',()=>{
  const rows=[incident('z',T-31*DAY),incident('a',T-31*DAY),incident('seven',T-7*DAY),incident('day',T-DAY),incident('fresh',T-1),incident('missing',null),incident('future',T+1),incident('resolved',T-80*DAY,{status:'resolved'})].map(i=>({...i,updated_at:iso(T+DAY)}));const r=calculateAnalytics(rows,[],'24h',T);
  assert.equal(r.total,2);assert.deepEqual(r.ageBands.map(b=>b.count),[1,1,1,2,2]);assert.deepEqual(r.oldest.map(i=>i.id),['a','z','seven','day','fresh']);assert.equal(r.oldest[0].ageHours,31*24);
});
test('published metadata activity includes older parents and deduplicates; unavailable is not zero',()=>{
  const rows=[incident('old',T-50*DAY),incident('new',T-1)],changes=[{id:'u',incident_id:'old',kind:'update',published_at:iso(T-1)},{id:'e',incident_id:'new',kind:'edit',published_at:iso(T-DAY)},{id:'end',incident_id:'new',kind:'update',published_at:iso(T)},{id:'other',incident_id:'foreign',kind:'update',published_at:iso(T-1)}];
  assert.equal(calculateAnalytics(rows,null,'24h',T).updates,null);assert.equal(calculateAnalytics(rows,[],'24h',T).updates,0);const r=calculateAnalytics(rows,[...changes,changes[0]],'24h',T);assert.equal(r.updates,1);assert.deepEqual(r.recent.map(c=>c.id),['u','e']);
});
test('analytics projections omit reporter identity, body, exact GPS and private media metadata',()=>{
  const r=calculateAnalytics([incident('a',T-1,{reporter_id:'sensitive',description:'secret prose',latitude:24.8,storage_path:'private/path'})],[{id:'u',incident_id:'a',kind:'update',published_at:iso(T-1),body:'secret update',transcript:'secret voice'}],'24h',T);const serialized=JSON.stringify(r);for(const value of ['sensitive','secret prose','24.8','private/path','secret update','secret voice'])assert.ok(!serialized.includes(value));
});
test('comparison half-open boundaries, zero baseline and sample thresholds are deterministic',()=>{
  const w=analyticsWindow('24h',T),r=categoryComparison([incident('prev',T-2*DAY),incident('current',T-DAY),incident('before',T-2*DAY-1),incident('end',T)],w)[0];assert.deepEqual([r.current,r.previous,r.difference,r.percentage,r.smallSample],[1,1,0,null,true]);
  const counts=(a,b)=>categoryComparison([...Array.from({length:a},(_,n)=>incident('c'+n,T-1)),...Array.from({length:b},(_,n)=>incident('p'+n,T-DAY-1))],w)[0];assert.equal(counts(8,0).percentage,null);assert.equal(counts(11,9).percentage,null);assert.equal(counts(20,10).percentage,100);assert.equal(counts(0,0).smallSample,true);
});
function clientFor(data,{failPage=null,onQuery,rowCap=Infinity}={}){
  const calls=[];return {calls,from(table){const state={table,offset:0,end:0};const q={};for(const method of ['select','eq','in','lt','gte','order','abortSignal'])q[method]=(...args)=>{calls.push([method,...args]);if(method==='in')state.ids=args[1];if(method==='eq'&&args[0]==='submission_state')state.published=args[1]==='published';return q;};q.range=(offset,end)=>{state.offset=offset;state.end=end;calls.push(['range',offset,end]);return q;};q.then=resolve=>{onQuery?.();return Promise.resolve(failPage===state.offset?{error:new Error('read failed')}:{data:data.filter(c=>state.ids.includes(c.incident_id)&&(!state.published||c.submission_state!=='draft')).slice(state.offset,Math.min(state.end+1,state.offset+rowCap)),error:null}).then(resolve);};return q;}};
}
test('configured row cap and draft rows cannot silently truncate activity totals',async()=>{
  const data=Array.from({length:6},(_,n)=>({id:'a'+n,incident_id:'a',kind:'update',published_at:iso(T-1),submission_state:n===5?'draft':'published'}));const client=clientFor(data,{rowCap:2});const r=await fetchAnalyticsActivity(client,{incidentIds:['a'],to:T,pageSize:500});assert.equal(r.length,5);assert.deepEqual(client.calls.filter(c=>c[0]==='range').map(c=>c[1]),[0,2,4,5]);assert.ok(!r.some(c=>c.id==='a5'));
});
test('zero/one report datasets and a zero-age report have legitimate exact counts',()=>{
  const empty=calculateAnalytics([],[],'all',T);assert.deepEqual([empty.total,empty.resolved,empty.unresolved,empty.updates],[0,0,0,0]);assert.deepEqual(empty.timeline,[]);const one=calculateAnalytics([incident('one',T)],[],'all',T);assert.equal(one.total,1);assert.equal(one.ageBands[0].count,1);assert.equal(one.oldest[0].ageHours,0);
});
test('activity paginates all pages/batches, explicitly excludes drafts, and fetches only four metadata fields',async()=>{
  const data=Array.from({length:7},(_,n)=>({id:'c'+n,incident_id:n<5?'a':'b',kind:'update',published_at:iso(T-1),body:'not copied'}));const client=clientFor(data);const r=await fetchAnalyticsActivity(client,{incidentIds:['a','b'],from:T-DAY,to:T,pageSize:2,batchSize:1});assert.equal(r.length,7);assert.deepEqual(client.calls.filter(c=>c[0]==='range').map(c=>c[1]),[0,2,4,5,0,2]);assert.ok(client.calls.some(c=>c[0]==='eq'&&c[1]==='submission_state'&&c[2]==='published'));assert.ok(client.calls.filter(c=>c[0]==='select').every(c=>c[1]===analyticsActivityColumns));assert.ok(r.every(c=>!('body' in c)));assert.ok(client.calls.some(c=>c[0]==='gte'&&c[2]===iso(T-DAY)));assert.ok(client.calls.some(c=>c[0]==='lt'&&c[2]===iso(T)));
});
test('failure on later activity page rejects partial totals; cancellation rejects and empty parents succeed',async()=>{
  const data=[0,1].map(n=>({id:String(n),incident_id:'a',kind:'update',published_at:iso(T-1)}));await assert.rejects(fetchAnalyticsActivity(clientFor(data,{failPage:2}),{incidentIds:['a'],to:T,pageSize:2}),/read failed/);
  const controller=new AbortController();await assert.rejects(fetchAnalyticsActivity(clientFor(data,{onQuery:()=>controller.abort()}),{incidentIds:['a'],to:T,signal:controller.signal}),/cancelled/);assert.deepEqual(await fetchAnalyticsActivity(clientFor([]),{incidentIds:[],to:T}),[]);
});
test('production analytics excludes old demo totals and unsupported performance metrics',async()=>{
  const page=await readFile(new URL('../src/pages/OperationsPage.jsx',import.meta.url),'utf8'),view=await readFile(new URL('../src/components/OperationsAnalytics.jsx',import.meta.url),'utf8'),mock=await readFile(new URL('../src/data/mockData.js',import.meta.url),'utf8');for(const text of ['QuickAnalytics','76.7%','2,481','1,904','577'])assert.ok(!(page+view+mock).includes(text),text);for(const text of ['Average response time','Resolution duration','SLA compliance','Resolution timeline','updated_at'])assert.ok(!view.includes(text),text);assert.match(page,/<OperationsAnalytics/);assert.ok(!view.includes('localStorage'));
});

