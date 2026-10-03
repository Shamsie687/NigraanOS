import {useMemo,useState} from 'react';
import useAnalyticsActivity from '../hooks/useAnalyticsActivity';
import {calculateAttention,filterAttention,attentionReasons} from '../utils/emergencyOperations';
import {DAY,DOMAINS} from '../utils/operationsAnalytics';
import {hasValidCoordinates} from '../utils/incidentMap';
import {displayStatus,reportCategories} from '../data/reportOptions';
import IncidentMapSection from './IncidentMapSection';
import IncidentInspector from './IncidentInspector';
import IncidentDetail from './IncidentDetail';
import CityEnvironmentPanel from './CityEnvironmentPanel';
import {city} from '../config/city';
const labels=['Recorded Critical','Recorded High','New · Awaiting acknowledgement','Recently Citizen-updated'];
const time=value=>new Date(value).toLocaleString('en-GB',{timeZone:city.timezone});
function Facts({incident}){
  return <><p>{reportCategories.find(c=>c.id===incident.category)?.label||'Unknown / legacy category'} · {DOMAINS.status.includes(incident.status)?displayStatus(incident.status):'Unknown / legacy workflow'}</p><p>Recorded priority: {DOMAINS.priority.includes(incident.priority)?displayStatus(incident.priority):'Unknown / legacy'}</p><div className="attention-reasons">{incident.reasons.map(reason=><span key={reason}>{reason}</span>)}</div><small>{incident.ageHours===null?'Report age unavailable':incident.ageHours.toLocaleString('en-GB',{maximumFractionDigits:1})+' hr since report start'} · {hasValidCoordinates(incident)?'Coordinates available':'Cannot be mapped'}</small>{incident.latestUpdate&&<p className="muted">Latest qualifying Citizen update: {time(incident.latestUpdate)} PKT</p>}</>;
}
export function EmergencyView({data,activityStatus,feed,environment,selectedId,onSelect,onClose,onUpdated,onNavigate}){
  const [category,setCategory]=useState('all'),[status,setStatus]=useState('all'),[reason,setReason]=useState('all'),[full,setFull]=useState(false);
  const [completion,setCompletion]=useState('');
  const visible=filterAttention(data.candidates,{category,status,reason});
  const selected=data.candidates.find(i=>i.id===selectedId);
  const missing=visible.filter(i=>!hasValidCoordinates(i)).length;
  function select(id){setFull(false);setCompletion('');onSelect(id);}
  async function updated(){await onUpdated();if(selected?.status==='in_progress')setCompletion('Selected incident workflow completed. Resolved incidents leave Urgent Attention after refresh.');}
  return <main className="dashboard urgent-operations">
    <div className="page-heading"><div><h2>Emergency Operations</h2><p>Focused review of recorded priorities, new reports and recent Citizen updates.</p></div><span className="demo-tag">Authorized incident review</span></div>
    <p className="muted urgent-purpose">Opening this workspace does not declare a city emergency, activate a shared emergency state, dispatch responders or verify reports. Access is not limited by the Karachi map viewport.</p>
    <div className="urgent-links"><button className="secondary" onClick={()=>onNavigate('Dashboard')}>Command Center</button><button className="secondary" onClick={()=>onNavigate('Analytics')}>Open Analytics</button><button className="secondary" onClick={()=>onNavigate('Nigraan AI')}>Open Nigraan AI</button><button disabled={feed.loading} onClick={feed.refresh}>Refresh incidents</button><span role="status">{feed.loading?'Refreshing incidents…':feed.error?'Incident read unavailable':data.to!==null?'Snapshot: '+time(data.to)+' PKT':'Waiting for first incident read'}</span></div>
    {feed.error?<section className="panel"><h3>Urgent Operations unavailable</h3><p role="alert">Unable to read authorized incidents. Retry using Refresh incidents.</p></section>:<>
      <div className="urgent-cards">{labels.map((label,index)=><section className="panel" key={label}><span>{label}</span><strong>{data.to===null?'Loading':index===3&&activityStatus!=='ready'?(activityStatus==='loading'?'Loading':'Unavailable'):data.counts[index]}</strong></section>)}</div>
      <p className="muted">Counts overlap. New reports and Citizen updates use the previous 24 hours at this snapshot. Report age starts at report creation, not guaranteed publication.</p>
      {activityStatus!=='ready'&&<p role="status" className="notice">{activityStatus==='loading'?'Loading published Citizen update metadata.':'Recent-update eligibility unavailable; not assumed to be zero.'} Known recorded-priority and new-report candidates remain available.</p>}
      <div className="urgent-filters"><label>Category<select aria-label="Category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{reportCategories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label>Workflow<select aria-label="Workflow" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option>{DOMAINS.status.map(s=><option key={s} value={s}>{displayStatus(s)}</option>)}</select></label><label>Attention reason<select aria-label="Attention reason" value={reason} onChange={e=>setReason(e.target.value)}><option value="all">All reasons</option>{attentionReasons.map(r=><option key={r}>{r}</option>)}</select></label></div>
      <p role="status">{visible.length} of {data.candidates.length} attention candidates{missing>0?' · '+missing+' attention incidents cannot be mapped':''}</p>
      <div className="urgent-grid"><IncidentMapSection incidents={visible} onSelect={select} selectedId={selected?.id} externalFilters fitLabel="Fit attention incidents" loading={feed.loading}/><section className="panel urgent-queue"><div className="panel-header"><h3>Urgent Attention</h3></div><p className="muted">Deterministic review ordering · recorded priority, then review signals.</p>{!visible.length&&<p role="status">{data.to===null?'Waiting for first incident read.':data.candidates.length?'No attention candidates match these filters.':activityStatus==='ready'?'No incidents currently meet the Urgent Attention criteria.':'No known priority/new-report candidates. Update-based candidates are not yet available.'}</p>}{visible.map(i=><article key={i.id} className={selected?.id===i.id?'attention-selected':''}><h4 dir="auto">{i.title}</h4><Facts incident={i}/><button aria-pressed={selected?.id===i.id} className="secondary" onClick={()=>select(i.id)}>View Incident</button></article>)}</section></div>
      {(completion||feed.reports.some(i=>i.id===selectedId&&i.status==='resolved'))&&<p className="success" role="status">{completion||'Selected incident is resolved and has left Urgent Attention.'}</p>}
      {selected&&<section className="urgent-selected"><Facts incident={selected}/><IncidentInspector key={selected.id} incident={selected} onClose={()=>{setFull(false);onClose();}} onUpdated={updated} onFullDetails={()=>setFull(true)}/>{full&&<IncidentDetail key={selected.id} incident={selected} onClose={()=>setFull(false)} onUpdated={updated}/>}</section>}
      <section className="panel urgent-activity"><div className="panel-header"><h3>Recent candidate Citizen updates</h3></div>{activityStatus!=='ready'?<p>Published update metadata {activityStatus==='loading'?'loading':'unavailable'}.</p>:!data.candidates.some(i=>i.latestUpdate)?<p>No qualifying published updates for current candidates.</p>:data.candidates.filter(i=>i.latestUpdate).sort((a,b)=>b.latestUpdate-a.latestUpdate||String(a.id).localeCompare(String(b.id))).slice(0,5).map(i=><article key={i.id}><p>Citizen update available · {time(i.latestUpdate)} PKT</p><h4 dir="auto">{i.title}</h4><button className="text-button" onClick={()=>select(i.id)}>View Incident</button></article>)}</section>
    </>}
    <CityEnvironmentPanel context={environment} city={city}/>
  </main>;
}
export default function EmergencyOperations({feed,accountId,...props}){
  const to=feed.lastUpdated?.getTime()??null;
  const unresolved=useMemo(()=>feed.reports.filter(i=>i.submission_state==='submitted'&&i.status!=='resolved'),[feed.reports]);
  const activity=useAnalyticsActivity({incidents:unresolved,from:to===null?null:to-DAY,to,accountId,enabled:to!==null&&!feed.error});
  const data=calculateAttention(feed.error?[]:feed.reports,activity.rows,to);
  return <EmergencyView {...props} feed={feed} data={data} activityStatus={activity.status}/>;
}
