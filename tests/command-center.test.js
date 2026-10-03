import test from 'node:test';
import assert from 'node:assert/strict';
import {commandSummary,displayInitials,recentActivity} from '../src/utils/commandCenter.js';
import {loadCommandActivity} from '../src/services/commandActivity.js';
import {prioritizeIncidents} from '../src/utils/incidentMap.js';
const now=Date.parse('2026-10-03T12:00:00Z');
const rows=[['a','reported','critical',0],['b','in_progress','high',24],['c','resolved','critical',2],['d','assigned','high',25],['e','acknowledged','high',1]].map(([id,status,priority,hours])=>({id,status,priority,reported_at:new Date(now-hours*3600000).toISOString()}));
test('summary uses authorized rows, status and an explicit inclusive previous 24h window',()=>{
  assert.deepEqual(commandSummary(rows,now),{active:4,awaiting:1,inProgress:1,newReports:4});
  assert.equal(commandSummary([...rows,{status:'resolved',reported_at:'invalid'},{status:'resolved',reported_at:new Date(now+1).toISOString()}],now).newReports,4);
  assert.deepEqual(commandSummary([],now),{active:0,awaiting:0,inProgress:0,newReports:0});
});
test('attention keeps recorded priority then newest first, excludes resolved and limits three',()=>{
  assert.deepEqual(prioritizeIncidents(rows,3).map(i=>i.id),['a','e','b']);
});
test('activity combines report time with published changes, never updated_at/status history, max five',()=>{
  const changes=[{id:'edit',incident_id:'d',kind:'edit',published_at:new Date(now-1000).toISOString()},{id:'update',incident_id:'b',kind:'update',published_at:new Date(now-2000).toISOString()},{id:'foreign',incident_id:'foreign',kind:'update',published_at:new Date(now).toISOString()},{id:'status',incident_id:'a',kind:'status',published_at:new Date(now).toISOString()}];
  const result=recentActivity(rows.map(i=>({...i,updated_at:new Date(now+1000).toISOString()})),changes);
  assert.equal(result.length,5);assert.deepEqual(result.slice(0,3).map(i=>i.kind),['report','edit','update']);assert.ok(result.every(i=>!['foreign','status'].includes(i.id)));
});
test('activity query explicitly excludes drafts, restricts authorized parents and fetches no body/evidence',async()=>{
  const calls=[];const query={};for(const method of ['select','eq','in','order','limit','abortSignal'])query[method]=(...args)=>{calls.push([method,...args]);return query;};query.then=resolve=>resolve({data:[],error:null});
  await loadCommandActivity({from:table=>{calls.push(['from',table]);return query;}},['a','b']);
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='submission_state'&&c[2]==='published'));assert.deepEqual(calls.find(c=>c[0]==='in'),['in','incident_id',['a','b']]);assert.equal(calls.find(c=>c[0]==='select')[1],'id,incident_id,kind,published_at');
  query.then=resolve=>resolve({error:new Error('denied')});await assert.rejects(loadCommandActivity({from:()=>query},['a']),/denied/);
});
test('display initials use actual display name with safe fallback',()=>{assert.equal(displayInitials(' Ayesha Noor '),'AN');assert.equal(displayInitials('علی'),'ع');assert.equal(displayInitials(null),'OP');});
