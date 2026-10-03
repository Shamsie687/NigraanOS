export function commandSummary(incidents,now=Date.now()){
  return {active:incidents.filter(i=>i.status!=='resolved').length,awaiting:incidents.filter(i=>i.status==='reported').length,inProgress:incidents.filter(i=>i.status==='in_progress').length,newReports:incidents.filter(i=>{const t=Date.parse(i.reported_at);return Number.isFinite(t)&&t>=now-86400000&&t<=now;}).length};
}
export function displayInitials(name){const parts=typeof name==='string'?name.trim().split(/\s+/).filter(Boolean):[];return parts.length?[parts[0],...(parts.length>1?[parts.at(-1)]:[])].map(p=>[...p][0]).join('').toLocaleUpperCase():'OP';}
export function recentActivity(incidents,changes,limit=5){
  const byId=new Map(incidents.map(i=>[i.id,i]));
  return [...incidents.map(i=>({id:'report-'+i.id,kind:'report',time:i.reported_at,incident:i})),...changes.filter(c=>byId.has(c.incident_id)&&['edit','update'].includes(c.kind)).map(c=>({id:c.id,kind:c.kind,time:c.published_at,incident:byId.get(c.incident_id)}))].filter(e=>Number.isFinite(Date.parse(e.time))).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||a.id.localeCompare(b.id)).slice(0,limit);
}
