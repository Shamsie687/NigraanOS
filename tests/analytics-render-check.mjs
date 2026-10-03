import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {calculateAnalytics,DAY} from '../src/utils/operationsAnalytics.js';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const {AnalyticsView}=await server.ssrLoadModule('/src/components/OperationsAnalytics.jsx');const T=Date.parse('2026-10-03T12:00:00Z');const record={id:'one',title:'Stored <script> title',reported_at:new Date(T-DAY).toISOString(),category:'traffic',status:'reported',priority:'normal',submission_state:'submitted'};
  const render=(data,activityStatus='ready',error='')=>renderToString(React.createElement(AnalyticsView,{data,activityStatus,error,period:'7d'}));
  const html=render(calculateAnalytics([record],[],'7d',T));for(const text of ['Operations Analytics','Authorized submitted incidents','Reports started','Currently unresolved','Currently resolved','Citizen updates','Report Volume','Current Backlog','Oldest unresolved','View Incident','Current status','Recorded priority','Unknown / legacy','Report starts','Citizen edits may reclassify','View count table','View timeline table','Small sample'])assert.ok(html.includes(text),text);
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));const failed=render(calculateAnalytics([record],null,'7d',T),'unavailable');assert.ok(failed.includes('<span>Citizen updates</span><strong>Unavailable</strong>'));assert.ok(failed.includes('not assumed to be zero'));const empty=render(calculateAnalytics([],[],'7d',T));assert.ok(empty.includes('No reports started'));assert.ok(empty.includes('No published Citizen edits'));assert.ok(empty.includes('<span>Citizen updates</span><strong>0</strong>'));
  const denied=render(null,'unavailable','read denied');assert.ok(!denied.includes('Stored'));assert.ok(!denied.includes('analytics-chart'));assert.ok(denied.includes('Incident analytics unavailable'));
  console.log('Analytics rendering passed: scoped facts, small/empty/read-failure states, legacy buckets, accessible charts/tables, safe stored titles and current-workflow semantics.');
}finally{await server.close();}
