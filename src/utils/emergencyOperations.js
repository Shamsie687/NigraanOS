import {DAY,timestamp} from './operationsAnalytics.js';
export const attentionReasons=['Recorded critical priority','Recorded high priority','New · Awaiting acknowledgement','Recent Citizen update'];
export function calculateAttention(incidents,activity,to){
  const updates=new Map(),counts=[0,0,0,activity===null?null:0];
  const valid=Number.isFinite(to),inside=value=>{const t=timestamp(value);return valid&&t!==null&&t>=to-DAY&&t<to;};
  const parents=new Map(incidents.filter(i=>i.submission_state==='submitted'&&i.status!=='resolved').map(i=>[i.id,i]));
  for(const event of activity||[]){
    if(event.submission_state!==undefined&&event.submission_state!=='published')continue;
    if(event.kind==='update'&&parents.has(event.incident_id)&&inside(event.published_at))updates.set(event.incident_id,Math.max(updates.get(event.incident_id)||0,timestamp(event.published_at)));
  }
  const candidates=[];
  for(const incident of parents.values()){
    const flags=[incident.priority==='critical',incident.priority==='high',incident.status==='reported'&&inside(incident.reported_at),updates.has(incident.id)];
    flags.forEach((flag,index)=>{if(flag)counts[index]++;});
    if(!flags.some(Boolean))continue;
    const reported=timestamp(incident.reported_at),reportTime=valid&&reported!==null&&reported<to?reported:null;
    candidates.push({...incident,tier:flags.indexOf(true),reasons:attentionReasons.filter((_,index)=>flags[index]),reportTime,ageHours:reportTime===null?null:(to-reportTime)/3600000,latestUpdate:updates.get(incident.id)||null});
  }
  const idOrder=(a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0;
  candidates.sort((a,b)=>a.tier-b.tier||(a.tier===3?b.latestUpdate-a.latestUpdate:0)||(a.reportTime??Infinity)-(b.reportTime??Infinity)||idOrder(a,b));
  return {candidates,counts,to};
}
export function filterAttention(candidates,{category='all',status='all',reason='all'}={}){
  return candidates.filter(i=>(category==='all'||i.category===category)&&(status==='all'||i.status===status)&&(reason==='all'||i.reasons.includes(reason)));
}
