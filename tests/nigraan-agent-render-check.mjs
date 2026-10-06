import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {briefingFixture} from './investigation-presentation-fixtures.js';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {NigraanAgentView}=await server.ssrLoadModule('/src/components/NigraanAgent.jsx');
 const render=(thread=[],busy=false,tool='')=>renderToString(React.createElement(NigraanAgentView,{thread,busy,tool,onSubmit(){},onClear(){},connection:{status:'connected'},isReferenceCurrent:()=>true}));
 const empty=render();for(const text of ['Nigraan Agent','Simulated Alexa+ experience','Not connected to Alexa+','What should we review','Operator request','INTERPRETATION','SUGGESTED ACTION','Clear conversation'])assert.ok(empty.includes(text),text);
 const fact=render([{id:1,role:'operator',text:'<script>private input</script>'},{id:2,role:'agent',tool:'get_city_status',referenceVersion:1,result:{kind:'FACT',headline:'City status',snapshotAt:0,facts:{submitted:0},incidents:[]}}]);assert.ok(fact.includes('&lt;script&gt;'));assert.ok(!fact.includes('<script>'));assert.ok(fact.includes('FACT'));assert.ok(fact.includes('No incidents in this result'));assert.ok(render([{id:3,role:'agent',error:true,text:'Read unavailable'}]).includes('Read unavailable'));assert.ok(render([],true,'get_city_status').includes('Reading'));
 const investigation=render([{id:4,role:'agent',referenceVersion:2,result:{kind:'INVESTIGATION',investigation:await briefingFixture()}}]);
 for(const text of ['Human operators make operational decisions','hours since report start','Human review briefing','Collected reads are not an atomic snapshot'])assert.ok(investigation.includes(text),text);
 console.log('Agent render passed: existing states and M3B investigation disclosure/provenance.');
}finally{await server.close();}
