import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAttention,filterAttention} from '../src/utils/emergencyOperations.js';
import {hasValidCoordinates,filterMapIncidents} from '../src/utils/incidentMap.js';
const T=Date.parse('2026-10-03T12:00:00Z'),DAY=86400000,iso=t=>new Date(t).toISOString();
const i=(id,extra={})=>({id,title:'Report',submission_state:'submitted',priority:'normal',status:'assigned',reported_at:iso(T-2*DAY),category:'traffic',latitude:24,longitude:67,...extra});
const e=(id,t=T-1,extra={})=>({id:'event'+id,incident_id:id,kind:'update',submission_state:'published',published_at:iso(t),...extra});
test('exact priorities, submitted unresolved scope and unknown values',()=>{
 const r=calculateAttention([i('c',{priority:'critical'}),i('h',{priority:'high'}),i('r',{priority:'critical',status:'resolved'}),i('d',{priority:'high',submission_state:'draft'}),i('u',{priority:'HIGH'}),i('s',{priority:'critical',status:'legacy'})],[],T);
 assert.deepEqual(r.candidates.map(x=>x.id),['c','s','h']);assert.deepEqual(r.counts,[2,1,0,0]);
});
test('new report window exact bounds, invalid and future dates',()=>{
 const rows=[i('start',{status:'reported',reported_at:iso(T-DAY)}),i('before',{status:'reported',reported_at:iso(T-DAY-1)}),i('end',{status:'reported',reported_at:iso(T)}),i('future',{status:'reported',reported_at:iso(T+1)}),i('bad',{status:'reported',reported_at:'bad'})];
 assert.deepEqual(calculateAttention(rows,[],T).candidates.map(x=>x.id),['start']);
});
test('published updates only, authorized parents, boundary and distinct incidents',()=>{
 const rows=['a','b','c','d','f','z'].map(id=>i(id));const events=[e('a',T-DAY),e('a',T-1),e('b',T,{kind:'update'}),e('c',T-1,{kind:'edit'}),e('d',T-1,{submission_state:'draft'}),e('f',T+1),e('absent'),e('z',T-DAY-1)];
 const r=calculateAttention(rows,events,T);assert.deepEqual(r.candidates.map(x=>x.id),['a']);assert.equal(r.counts[3],1);assert.equal(r.candidates[0].latestUpdate,T-1);
});
test('deduplicated overlapping reasons and tier ordering',()=>{
 const r=calculateAttention([i('all',{priority:'high',status:'reported',reported_at:iso(T-2)}),i('critical',{priority:'critical'}),i('new',{status:'reported',reported_at:iso(T-3)}),i('update')],[e('all'),e('update')],T);
 assert.deepEqual(r.candidates.map(x=>x.id),['critical','all','new','update']);assert.equal(r.candidates[1].reasons.length,3);assert.deepEqual(r.counts,[1,1,2,2]);
});
test('oldest first, invalid last, ID tie-break, recent update newest first',()=>{
 const r=calculateAttention([i('z',{priority:'critical'}),i('a',{priority:'critical'}),i('invalid',{priority:'critical',reported_at:null}),i('old',{priority:'critical',reported_at:iso(T-3*DAY)}),i('u'),i('v')],[e('u',T-10),e('v',T-1)],T);
 assert.deepEqual(r.candidates.map(x=>x.id),['old','a','z','invalid','v','u']);assert.equal(r.candidates[3].ageHours,null);
});
test('activity failure retains known candidates, resolved disappears, empty means empty',()=>{
 assert.deepEqual(calculateAttention([i('a',{priority:'high'})],null,T).counts,[0,1,0,null]);assert.equal(calculateAttention([i('a',{priority:'high',status:'resolved'})],[],T).candidates.length,0);assert.equal(calculateAttention([],[],T).candidates.length,0);
});
test('shared filters retain unmappable queue items',()=>{
 const r=calculateAttention([i('gps',{priority:'critical'}),i('missing',{priority:'high',latitude:null}),i('water',{priority:'high',category:'water'})],[],T);
 const visible=filterAttention(r.candidates,{category:'traffic',status:'assigned'});assert.deepEqual(visible.map(x=>x.id),['gps','missing']);assert.deepEqual(filterMapIncidents(visible).map(x=>x.id),['gps']);assert.equal(visible.filter(x=>!hasValidCoordinates(x)).length,1);assert.equal(filterAttention(r.candidates,{reason:'Recorded high priority'}).length,2);
});
