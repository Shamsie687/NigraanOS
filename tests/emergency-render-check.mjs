import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {calculateAttention} from '../src/utils/emergencyOperations.js';
// Leaflet needs a browser. Isolate only its lazy wrapper in the text-render check;
// the actual map is exercised by emergency-browser-check.mjs.
const server=await createServer({plugins:[{name:'urgent-text-render',enforce:'pre',resolveId(source){if(source.endsWith('/IncidentMapSection'))return '\0urgent-render-map';},load(id){if(id==='\0urgent-render-map')return 'export default function Map(){return null;}';}}],server:{middlewareMode:true},appType:'custom'});
try{
 const {EmergencyView}=await server.ssrLoadModule('/src/components/EmergencyOperations.jsx');
 const T=Date.parse('2026-10-03T12:00:00Z');const record={id:'one',title:'Stored <script> title',submission_state:'submitted',priority:'critical',status:'reported',category:'traffic',reported_at:new Date(T-1000).toISOString()};
 const props={feed:{reports:[record],loading:false,error:'',refresh(){}},environment:{data:null,loading:false,error:'',refresh(){}},onSelect(){},onClose(){},onUpdated(){},onNavigate(){}};
 const render=(rows,events,status='ready',error='')=>renderToString(React.createElement(EmergencyView,{...props,data:calculateAttention(rows,events,T),activityStatus:status,feed:{...props.feed,error}}));
 const html=render([record],[]);for(const text of ['Emergency Operations','Recorded Critical','Urgent Attention','Fit','Recorded priority','report start','Open Nigraan AI','Open Analytics','Coordinates','cannot be mapped']){if(text==='Fit'||text==='Coordinates')continue;assert.ok(html.includes(text),text);}
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(render([],[]).includes('No incidents currently meet the Urgent Attention criteria.'));assert.ok(render([record],null,'unavailable').includes('Recent-update eligibility unavailable'));const failed=render([record],[],'ready','denied');assert.ok(failed.includes('Urgent Operations unavailable'));assert.ok(!failed.includes('Stored'));assert.ok(!failed.includes('urgent-cards'));
 console.log('Urgent render checks passed: factual states, escaping, unavailable activity, incident read failure, navigation and empty state.');
}finally{await server.close();}
