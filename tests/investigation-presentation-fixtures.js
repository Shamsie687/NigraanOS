// Isolated UI test fixtures, never imported by the application.
import {createInvestigationController} from '../src/services/incidentInvestigation.js';
export async function briefingFixture({count=3,fail=[],changed=false,noReasons=false}={}) {
  let version=0,clock=Date.parse('2026-10-07T09:00:00Z');
  const incident=ref=>({ref,category:'traffic',status:noReasons?'in_progress':'reported',priority:noReasons?'normal':'high',ageHours:18});
  const tools={referenceVersion:()=>version,assertReference(){},async run(tool,input){
    clock+=1000;
    if(fail.includes(tool)||fail.includes(tool+':'+input.ref))throw Object.assign(new Error('PRIVATE_ERROR'),{code:'read'});
    const base={snapshotAt:clock,omitted:0};
    if(tool==='get_city_status'){version++;return {...base,facts:{submitted:5,unresolved:3,resolved:2,awaitingAcknowledgement:2}};}
    if(tool==='get_urgent_incidents'){version++;return {...base,incidents:Array.from({length:count},(_,i)=>incident('I'+(i+1)))};}
    if(tool==='get_incident_details')return {...base,incidents:[{...incident(input.ref),...(changed?{status:'acknowledged',priority:'normal'}:{})}]};
    if(tool==='get_incident_activity')return {...base,facts:{publishedUpdates:noReasons?0:1,publishedEdits:0},activity:[]};
    return {...base,context:{weather:{status:'current',temperatureC:29,precipitationMm:0,intervalSeconds:900,validAt:new Date(clock).toISOString(),fetchedAt:new Date(clock).toISOString()},air:{status:'stale',aqi:81,validAt:new Date(clock).toISOString(),fetchedAt:new Date(clock).toISOString()}}};
  }};
  return createInvestigationController({tools,now:()=>clock}).run();
}
