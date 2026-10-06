import {useEffect,useState} from 'react';
import {requireSupabase} from '../services/supabase';
import CitizenActivity from './CitizenActivity';
import ReportProgress from './ReportProgress';
import CitizenChangeForm from './CitizenChangeForm';
import {citizenAction} from '../utils/citizenChanges';
import {displayStatus} from '../data/reportOptions';
const columns='id,reporter_id,title,description,category,latitude,longitude,location_accuracy,area,status,priority,reported_at,updated_at,submission_state';
export default function CitizenReportDetail({report,userId,onClose,onChanged,onBusy}) {
  const [incident,setIncident]=useState(report);const [mode,setMode]=useState(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  async function refresh(){const result=await requireSupabase().from('incidents').select(columns).eq('id',report.id).eq('reporter_id',userId).maybeSingle();if(result.error||!result.data){setError('Unable to refresh your report. Try again before editing.');return;}setIncident(result.data);setError('');}
  useEffect(()=>{let alive=true;requireSupabase().from('incidents').select(columns).eq('id',report.id).eq('reporter_id',userId).maybeSingle().then(result=>{if(alive){if(result.error||!result.data)setError('Unable to load your report.');else setIncident(result.data);}});return()=>{alive=false;};},[report.id,userId]);
  function setWorking(value){setBusy(value);onBusy(value);}
  async function saved(){setMode(null);setSuccess('Your '+(mode==='edit'?'correction':'update')+' was saved.');await refresh();await onChanged();}
  const action=citizenAction(incident.status);const editAllowed=incident.status==='reported';const updateAllowed=['acknowledged','assigned','in_progress'].includes(incident.status);
  return <section className="citizen-panel"><div className="page-heading"><h2>{incident.title}</h2><button disabled={busy} onClick={onClose}>Close report</button></div><p><span className="status-pill">{displayStatus(incident.status)}</span> · {incident.area}</p>
    <ReportProgress status={incident.status}/>
    {Number.isFinite(incident.location_accuracy)&&<p className="muted">Location accuracy at report: approximately {Math.round(incident.location_accuracy)} m. This does not prove the photo location.</p>}
    {error&&<p className="error" role="alert">{error}</p>}{success&&<p className="success" role="status">{success}</p>}
    <button disabled={busy||Boolean(mode)} onClick={refresh}>Refresh report</button>
    {!mode&&action!=='View Details'&&<button className="primary" disabled={busy||Boolean(error)} onClick={()=>{setSuccess('');setMode(editAllowed?'edit':'update');}}>{action}</button>}
    <p dir="auto" className="transcript-text">{incident.description}</p>
    {incident.status==='resolved'&&<p className="verification-note">Completed · Read-only. This report cannot be edited, updated or reopened.</p>}
    {mode==='edit'&&!editAllowed&&<p role="alert" className="verification-note">This report has already been acknowledged or completed. The original report can no longer be edited.{updateAllowed&&<button onClick={()=>setMode('update')}>Add Update</button>}</p>}
    {mode==='update'&&!updateAllowed&&<p role="alert">This report no longer accepts updates.</p>}
    {(mode==='edit'&&editAllowed||mode==='update'&&updateAllowed)&&<CitizenChangeForm key={mode} incident={incident} kind={mode} userId={userId} onSaved={saved} onCancel={()=>setMode(null)} onBusy={setWorking} onRefresh={refresh}/>}
    <CitizenActivity incident={incident}/>
  </section>;
}
