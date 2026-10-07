import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {default:Progress}=await server.ssrLoadModule('/src/components/ReportProgress.jsx');
 const event={cursor:1,status:'acknowledged',kind:'transition',recordedAt:'2026-10-07T12:00:00Z'};
 const progress=renderToString(React.createElement(Progress,{status:'assigned',events:[event]}));assert.equal((progress.match(/<time/g)||[]).length,1);assert(progress.includes('dateTime="2026-10-07T12:00:00Z"')||progress.includes('datetime="2026-10-07T12:00:00Z"'));assert(progress.includes('Future stage'));assert(!progress.includes('Earlier transition times are not recorded here.'));
 const {default:View}=await server.ssrLoadModule('/src/components/CitizenAccountability.jsx');
 const html=renderToString(React.createElement(View,{data:{legacyHistory:true,organization:{name:'<safe org>',type:'ngo'},events:[event],updates:[{cursor:1,kind:'resolution',message:'<Resolution>',createdAt:event.recordedAt}]},updatedAt:1,onRefresh(){}}));
 for(const phrase of ['Earlier transition times are unavailable','Assigned Operations organization','Assignment does not confirm dispatch','Resolution information','&lt;Resolution&gt;','&lt;safe org&gt;','Last successful refresh','Refresh progress'])assert(html.includes(phrase));
 assert(!html.includes('author_id'));assert(!html.includes('actor_id'));
 const {default:Form}=await server.ssrLoadModule('/src/components/OperationsPublicUpdate.jsx');
 const form=renderToString(React.createElement(Form,{incident:{id:'fixture',status:'in_progress'},resolution:true,onUpdated(){}}));
 for(const phrase of ['Visible to the reporting Citizen','Resolution message','maxLength="1000"','Publish message and mark Resolved','disabled=""'])assert(form.includes(phrase));
 const {default:Inspector}=await server.ssrLoadModule('/src/components/IncidentInspector.jsx');
 const inspector=renderToString(React.createElement(Inspector,{incident:{id:'fixture',status:'in_progress'},onFullDetails(){}}));assert(inspector.includes('Resolve with update'));assert(!inspector.includes('Mark Resolved'));assert(!inspector.includes('View full details'));
 for(const [status,label] of [['reported','Mark Acknowledged'],['acknowledged','Assign to my Operations profile'],['assigned','Mark In progress']]){const html=renderToString(React.createElement(Inspector,{incident:{status},onFullDetails(){}}));assert(html.includes(label));}
 for(const file of ['src/pages/OperationsPage.jsx','src/components/EmergencyOperations.jsx']){const source=await readFile(file,'utf8');assert(/onFullDetails=\{\(\)=>set(?:FullDetails|Full)\(true\)\}/.test(source));}
 const {updateIncidentStatus}=await server.ssrLoadModule('/src/services/operations.js');await assert.rejects(updateIncidentStatus({status:'in_progress'}),/Citizen-visible message/);
 const detail=await readFile('src/components/IncidentDetail.jsx','utf8');assert(detail.includes('onUpdated={onUpdated} resolution'));
 const resolved=renderToString(React.createElement(Progress,{status:'resolved',events:[{...event,status:'resolved'}]}));assert(resolved.includes('Current stage'));assert.equal((resolved.match(/<time/g)||[]).length,1);
 console.log('Accountability render: real times, missing-history disclosure, safe organization, message escaping and explicit resolution visibility passed.');
}finally{await server.close();}
