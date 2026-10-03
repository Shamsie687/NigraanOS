import {useEffect,useState} from 'react';
import {loadCommandActivity} from '../services/commandActivity';
import {requireSupabase} from '../services/supabase';
import {recentActivity} from '../utils/commandCenter';
import {reportCategories} from '../data/reportOptions';
import {city} from '../config/city';
export default function CommandActivity({incidents,lastUpdated,onSelect}){
  const [changes,setChanges]=useState([]),[error,setError]=useState(false);
  useEffect(()=>{const controller=new AbortController();setChanges([]);setError(false);Promise.resolve().then(()=>loadCommandActivity(requireSupabase(),incidents.map(i=>i.id),controller.signal)).then(rows=>{if(!controller.signal.aborted)setChanges(rows);}).catch(()=>{if(!controller.signal.aborted){setChanges([]);setError(true);}});return()=>controller.abort();},[incidents,lastUpdated]);
  const items=recentActivity(incidents,changes);const labels={report:'New report',edit:'Citizen edited report',update:'Citizen added update'};
  return <section className="panel command-activity"><div className="panel-header"><h3>Recent Citizen Activity</h3><span className="muted">Latest five · Authorized reports</span></div>{error&&<p className="muted">Citizen edit/update activity unavailable. New reports are still shown.</p>}<div className="command-activity-list">{items.map(item=><article key={item.id}><div><strong>{labels[item.kind]}</strong><p>{item.incident.title} · {reportCategories.find(c=>c.id===item.incident.category)?.label||item.incident.category}</p><time dateTime={item.time}>{new Date(item.time).toLocaleString('en-GB',{timeZone:city.timezone})} PKT</time></div><button className="text-button" onClick={()=>onSelect(item.incident.id)}>View Incident →</button></article>)}{!items.length&&<p className="empty">No recent authorized report activity.</p>}</div></section>;
}
