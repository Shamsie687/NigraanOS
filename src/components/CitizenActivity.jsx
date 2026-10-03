import {useEffect,useState} from 'react';
import {fetchCitizenActivity} from '../services/citizenChanges';
import EvidenceViewer from './EvidenceViewer';
import {city} from '../config/city';
const time=value=>new Date(value).toLocaleString('en-GB',{timeZone:city.timezone});
const labels={title:'Title',description:'Description',category:'Category',area:'Area',latitude:'Latitude',longitude:'Longitude',location_accuracy:'GPS accuracy'};
export default function CitizenActivity({incident}) {
  const [rows,setRows]=useState([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [refresh,setRefresh]=useState(0);
  useEffect(()=>{let cancelled=false;setLoading(true);setRows([]);setError('');fetchCitizenActivity(incident.id).then(data=>{if(!cancelled)setRows(data);}).catch(cause=>{if(!cancelled)setError('Unable to load report activity. Check that migration 008 is applied. '+cause.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[incident.id,incident.updated_at,refresh]);
  const original=rows.find(row=>row.kind==='edit'&&row.original_snapshot)?.original_snapshot||incident;
  return <section className="citizen-activity" aria-label="Citizen report activity"><div className="page-heading"><h3>Citizen report activity</h3><button onClick={()=>setRefresh(value=>value+1)} disabled={loading}>Refresh activity</button></div>
    {loading&&<p role="status">Loading activity…</p>}{error&&<p className="error" role="alert">{error}</p>}
    {!loading&&!error&&<><article className="activity-entry"><h4>Original report</h4><small>{time(incident.reported_at)} · Citizen</small><p dir="auto">{original.title}</p><p className="transcript-text" dir="auto">{original.description}</p><p>{original.category} · {original.area} · GPS {original.latitude}, {original.longitude}</p><EvidenceViewer incidentId={incident.id} changeId={null}/></article>
      {rows.map(row=><article className="activity-entry" key={row.id}><h4>{row.kind==='edit'?'Citizen edited this report':'Citizen update'}</h4><small>{time(row.published_at)} · Citizen · {row.citizen_id.slice(0,8)}</small>
        {row.kind==='update'?<p className="transcript-text" dir="auto">{row.body}</p>:<details><summary>{Object.keys(row.new_values||{}).length?'Inspect changed fields':'New evidence added; original fields unchanged'}</summary><dl>{Object.entries(row.new_values||{}).map(([key,value])=><div key={key}><dt>{labels[key]||key}</dt><dd dir="auto">Before: {String(row.previous_values?.[key]??'Not recorded')}</dd><dd dir="auto">After: {String(value??'Not recorded')}</dd></div>)}</dl></details>}
        <EvidenceViewer incidentId={incident.id} changeId={row.id}/>
      </article>)}</>}
  </section>;
}
