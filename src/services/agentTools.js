import {fetchAnalyticsActivity} from './analyticsActivity.js';
import {loadCityContext} from './cityContext.js';
import {calculateAttention} from '../utils/emergencyOperations.js';
import {DAY,timestamp} from '../utils/operationsAnalytics.js';
import {city} from '../config/city.js';
import {projectAgentIncident as project,projectAgentConditions} from './agentProjection.js';
export {projectAgentConditions} from './agentProjection.js';

/** @typedef {{ref?:string,referenceVersion?:number,view?:string}} AgentInput
 * @typedef {{ref:string,category:string,status:string,priority:string,ageHours:number|null,reasons?:string[]}} AgentIncident
 * @typedef {{ref:string,kind:'edit'|'update',publishedAt:string}} AgentActivity
 * @typedef {{kind:'FACT'|'CONTEXT'|'NAVIGATION',headline:string,snapshotAt:number,incidents?:AgentIncident[],activity?:AgentActivity[],facts?:Record<string,number|null>,context?:object,omitted?:number,notice?:string}} AgentResult
 * Internal IDs stay in the instance-local map; never in AgentResult.
 */
export const AGENT_VIEWS={'Command Center':'Dashboard','Live Map':'Live Map','Incidents':'Citizen Reports','Urgent Operations':'Urgent Operations','Analytics':'Analytics'};
export const TOOL_DEFINITIONS=Object.freeze([
  {name:'get_city_status',effect:'read',input:{},output:'FACT: current counts and bounded incident references'},
  {name:'get_urgent_incidents',effect:'read',input:{},output:'FACT: existing Urgent Operations criteria, counts, reasons and bounded references'},
  {name:'get_incident_details',effect:'read',input:{ref:'required current I-reference'},output:'FACT: current submitted incident metadata'},
  {name:'get_city_conditions',effect:'read',input:{},output:'CONTEXT: modeled Karachi weather/AQ and provenance'},
  {name:'get_incident_activity',effect:'read',input:{ref:'optional current I-reference'},output:'FACT: published activity metadata in previous 24 hours'},
  {name:'navigate_to_incident',effect:'client navigation',input:{ref:'required current I-reference'},output:'NAVIGATION: existing authorized incident view'},
  {name:'navigate_to_view',effect:'client navigation',input:{view:'required allowlisted view'},output:'NAVIGATION: existing Operations destination'},
]);
export class AgentError extends Error{constructor(code,message){super(message);this.code=code;}}
const failure=(code,message)=>{throw new AgentError(code,message);};
export function validateToolInput(name,input){
  if(!TOOL_DEFINITIONS.some(t=>t.name===name)||!input||typeof input!=='object'||Array.isArray(input))failure('input','Unsupported tool input.');
  const keys=name==='navigate_to_view'?['view']:['get_incident_details','get_incident_activity','navigate_to_incident'].includes(name)?['ref','referenceVersion']:[];
  if(Object.keys(input).some(k=>!keys.includes(k)))failure('input','Unsupported tool input.');
  if((name==='get_incident_details'||name==='navigate_to_incident')&&!input.ref)failure('reference','Choose a reference from the latest incident result.');
  if(input.ref!==undefined&&(typeof input.ref!=='string'||!/^I[1-8]$/.test(input.ref)))failure('reference','Use a current incident reference such as I1.');
  if(input.referenceVersion!==undefined&&(!input.ref||!Number.isSafeInteger(input.referenceVersion)||input.referenceVersion<0))failure('reference','Invalid reference context.');
  if(name==='navigate_to_view'&&!Object.hasOwn(AGENT_VIEWS,input.view))failure('input','Choose a supported Operations view.');
}
const columns='id,category,status,priority,reported_at,submission_state';
export function createAgentTools({client,accountId,onIncident,onView,now=Date.now}){
  let refs=new Map(),expires=0,closed=false,referenceVersion=0;
  const clear=()=>{refs=new Map();expires=0;referenceVersion++;};
  const checkSignal=signal=>{if(closed||signal?.aborted)failure('cancelled','Request cancelled.');};
  async function authorize(signal){
    checkSignal(signal);
    const identity=await client.auth.getUser();checkSignal(signal);
    if(identity.error||identity.data?.user?.id!==accountId){clear();failure('access','Approved Operations access required.');}
    let query=client.rpc('is_approved_operations');if(signal&&query.abortSignal)query=query.abortSignal(signal);
    const approval=await query;checkSignal(signal);
    if(approval.error||approval.data!==true){clear();failure('access','Approved Operations access required.');}
  }
  async function incidents(signal){
    const records=new Map();
    // Same authenticated submitted-incidents source as Operations, projected to
    // metadata only. End on an empty page even when PostgREST lowers its row cap.
    for(let offset=0;;){
      checkSignal(signal);let q=client.from('incidents').select(columns).eq('submission_state','submitted').order('reported_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);if(signal)q=q.abortSignal(signal);
      const {data,error}=await q;checkSignal(signal);if(error||!Array.isArray(data))failure('read','Authorized incident facts are unavailable. Retry the read.');
      for(const row of data)if(row.submission_state==='submitted')records.set(row.id,row);
      if(!data.length)break;offset+=data.length;
    }
    return [...records.values()];
  }
  function reference(ref){if(now()>=expires){clear();failure('stale_reference','References expired. Ask for a fresh incident list.');}if(!refs.has(ref))failure('reference','That reference is not in the latest incident result.');return refs.get(ref);}
  async function detail(ref,signal){
    const id=reference(ref);let q=client.from('incidents').select(columns).eq('id',id).eq('submission_state','submitted');if(signal)q=q.abortSignal(signal);
    const {data,error}=await q.maybeSingle();checkSignal(signal);
    if(error||!data||data.id!==id||data.submission_state!=='submitted'){clear();failure('stale_reference','This incident is unavailable. Ask for a fresh list.');}return data;
  }
  async function activity(rows,to,signal){return fetchAnalyticsActivity(client,{incidentIds:rows.map(i=>i.id),from:to-DAY,to,signal});}
  function bind(rows,to){clear();rows.slice(0,8).forEach((row,n)=>refs.set('I'+(n+1),row.id));expires=to+5*60000;return rows.slice(0,8).map((row,n)=>({...project(row,'I'+(n+1),to),...(row.reasons?{reasons:[...row.reasons]}:{})}));}
  return {
    clear,referenceVersion:()=>referenceVersion,close(){closed=true;clear();},
    resolveOrdinal(index){if(now()>=expires){clear();failure('stale_reference','References expired. Ask for a fresh incident list.');}const ref=[...refs.keys()][index];if(!ref)failure('reference','No matching item in the latest incident result.');return ref;},
    /** @param {string} name @param {AgentInput} input @param {AbortSignal} signal @returns {Promise<AgentResult>} */
    async run(name,input={},signal){
      validateToolInput(name,input);
      try{
        await authorize(signal);
        if(input.referenceVersion!==undefined&&input.referenceVersion!==referenceVersion)failure('stale_reference','This card belongs to an older result. Use the latest incident list.');
        if(name==='navigate_to_view'){checkSignal(signal);onView(AGENT_VIEWS[input.view]);return {kind:'NAVIGATION',headline:'Opened '+input.view,snapshotAt:now()};}
        if(name==='get_city_conditions'){const data=await loadCityContext(client,city.id,signal);await authorize(signal);return {kind:'CONTEXT',headline:'City conditions · modeled context',snapshotAt:now(),context:projectAgentConditions(data)};}
        if(name==='get_incident_details'||name==='navigate_to_incident'){
          const row=await detail(input.ref,signal);await authorize(signal);
          if(name==='navigate_to_incident'){onIncident(row.id);return {kind:'NAVIGATION',headline:'Opened '+input.ref+' in Incidents',snapshotAt:now()};}
          return {kind:'FACT',headline:'Current incident details',snapshotAt:now(),incidents:[project(row,input.ref,now())]};
        }
        const rows=input.ref?[await detail(input.ref,signal)]:await incidents(signal),to=now();
        if(name==='get_city_status'){
          await authorize(signal);const unresolved=rows.filter(i=>i.status!=='resolved');
          return {kind:'FACT',headline:'Current city status · authorized reports',snapshotAt:to,facts:{submitted:rows.length,unresolved:unresolved.length,resolved:rows.length-unresolved.length,awaitingAcknowledgement:rows.filter(i=>i.status==='reported').length},incidents:bind(unresolved,to),omitted:Math.max(0,unresolved.length-8)};
        }
        if(name==='get_urgent_incidents'){
          const unresolved=rows.filter(i=>i.status!=='resolved');let events=null;
          try{events=await activity(unresolved,to,signal);}catch{checkSignal(signal);}
          await authorize(signal);const urgent=calculateAttention(rows,events,to);
          return {kind:'FACT',headline:'Urgent Attention · deterministic review signals',snapshotAt:to,facts:{recordedCritical:urgent.counts[0],recordedHigh:urgent.counts[1],newAwaitingAcknowledgement:urgent.counts[2],recentlyCitizenUpdated:urgent.counts[3]},incidents:bind(urgent.candidates,to),omitted:Math.max(0,urgent.candidates.length-8),notice:events===null?'Recent-update eligibility unavailable; known priority/new-report candidates only.':'Overlapping criteria; previous 24 hours. Report age is since report start.'};
        }
        const events=await activity(rows,to,signal);await authorize(signal);
        // Use a deterministic event order and expose only aliases/kind/time.
        events.sort((a,b)=>timestamp(b.published_at)-timestamp(a.published_at)||String(a.id).localeCompare(String(b.id)));
        let mapping;
        if(input.ref)mapping=new Map([[rows[0].id,input.ref]]);
        else{const parents=new Map(rows.map(i=>[i.id,i])),ordered=[...new Set(events.map(e=>e.incident_id))].map(id=>parents.get(id));bind(ordered,to);mapping=new Map([...refs].map(([ref,id])=>[id,ref]));}
        return {kind:'FACT',headline:'Published Citizen activity · previous 24 hours',snapshotAt:to,incidents:input.ref?[project(rows[0],input.ref,to)]:[...mapping].map(([id,ref])=>project(rows.find(i=>i.id===id),ref,to)),activity:events.filter(e=>mapping.has(e.incident_id)).slice(0,8).map(e=>({ref:mapping.get(e.incident_id),kind:e.kind,publishedAt:e.published_at})),facts:{publishedUpdates:events.filter(e=>e.kind==='update').length,publishedEdits:events.filter(e=>e.kind==='edit').length},omitted:Math.max(0,events.length-events.filter(e=>mapping.has(e.incident_id)).slice(0,8).length)};
      }catch(error){checkSignal(signal);if(error instanceof AgentError)throw error;failure('read','Read unavailable. Retry or open the existing Operations view.');}
    },
  };
}
