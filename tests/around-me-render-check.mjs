import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import React from 'react';
import {renderToString} from 'react-dom/server';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {AroundMeCards,AroundMeResults}=await server.ssrLoadModule('/src/components/CitizenAroundMe.jsx');
 const data={snapshotDay:'2026-10-08',reportingWindowDays:30,cells:[{cellId:'K-8-10',groups:[{category:'water',publicWorkflowState:'resolved',reportCountBand:'5–9'}]}]};
 const cards=renderToString(React.createElement(AroundMeCards,{cells:data.cells,selected:'K-8-10'}));
 for(const text of ['Generalized area K-8-10','Water','Marked resolved in NigraanOS','5–9 reports','selected'])assert(cards.replace(/<!--.*?-->/g,'').includes(text),text);assert(!cards.includes('View incident'));
 const empty=renderToString(React.createElement(AroundMeResults,{feed:{data:{...data,cells:[]},loading:false},cells:[]}));assert(empty.includes('No report groups are available here under the current privacy rules'));assert(!empty.includes('No incidents nearby'));assert(empty.includes('30 days before that day'));
 const loading=renderToString(React.createElement(AroundMeResults,{feed:{loading:true},cells:[]}));assert(!loading.includes('No report groups'));
 const map=await readFile('src/components/AroundMeMap.jsx','utf8');assert(map.includes('<Rectangle'));assert(!/<Marker\b/.test(map));assert(map.includes('maxZoom={13}'));assert(map.includes('url={city.tileUrl}'));assert(map.includes('attribution={city.attribution}'));assert(!map.includes('incidentMapData'));
 const citizen=await readFile('src/pages/CitizenPage.jsx','utf8');assert(citizen.includes("['around','◎','Around Me']"));assert(citizen.includes('<CitizenAroundMe userId={session.userId}/>'));
 const hook=await readFile('src/hooks/useAroundMe.js','utf8');assert(hook.includes('lastDay===day()'));assert(hook.includes('pending'));assert(hook.includes('controller?.abort()'));assert(hook.includes('session?.user.id!==userId'));assert(!hook.includes('localStorage'));
 const component=await readFile('src/components/CitizenAroundMe.jsx','utf8');assert(component.includes('onClick={myLocation}'));assert(component.includes('generalizeLocation(lat,lng)'));assert(component.includes('filterAroundMe(feed.data?.cells||[],category,workflow)'));assert(!component.includes('watchPosition'));assert(!component.includes('localStorage'));
 console.log('Around Me render: safe aggregate cards, suppressed/loading semantics, grid-only Leaflet, attribution, navigation and lifecycle checks passed.');
}finally{await server.close();}
