import {useState} from 'react';
import {reportCategories,displayStatus} from '../data/reportOptions';
import {city} from '../data/mockData';
import {nextIncidentStatus} from '../utils/workspaceAccess';
import {updateIncidentStatus} from '../services/operations';
import CitizenActivity from './CitizenActivity';
export default function IncidentDetail({incident,onClose,onUpdated}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const next=nextIncidentStatus(incident.status);
  async function advance() {
    setBusy(true);setError('');
    try {await updateIncidentStatus(incident);await onUpdated();}
    catch(cause) {setError(cause.message);}
    finally {setBusy(false);}
  }
  return <section className="panel incident-detail" aria-label="Real incident detail">
    <div className="page-heading"><span className="eyebrow accent">REAL CITIZEN INCIDENT</span><button disabled={busy} onClick={onClose}>Close detail</button></div>
    <h2>{incident.title}</h2>
    <p>{reportCategories.find(category=>category.id===incident.category)?.label || incident.category} · {displayStatus(incident.status)} · Recorded priority: {displayStatus(incident.priority)}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {next?<div className="detail-primary-actions"><button className="primary" disabled={busy} onClick={advance}>{busy?'Updating…':next==='assigned'?'Assign to my Operations profile':'Mark '+displayStatus(next)}</button>{next==='assigned' && <p className="muted">Records your Operations profile; does not select a team, dispatch responders or establish exclusive ownership.</p>}</div>:<p className="muted">{incident.status==='resolved'?'This incident is resolved.':'This legacy status needs project-owner review before workflow updates.'}</p>}
    <p className="incident-description">{incident.description}</p>
    <dl><dt>Area</dt><dd>{incident.area || 'Not labeled'}</dd>
      <dt>GPS coordinates</dt><dd>{incident.latitude}, {incident.longitude}{incident.location_accuracy!=null && ' · accuracy ±'+incident.location_accuracy+' m'}</dd>
      <dt>Reported time</dt><dd>{new Date(incident.reported_at).toLocaleString('en-GB',{timeZone:city.timezone})} PKT</dd>
      <dt>Incident reference</dt><dd>{incident.id}</dd>
      {incident.assigned_organization_id && <><dt>Assigned Operations profile</dt><dd>{incident.assigned_organization_id}</dd></>}
    </dl>
    <CitizenActivity incident={incident}/>
  </section>;
}
