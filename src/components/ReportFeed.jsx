import EvidenceViewer from './EvidenceViewer';
import { reportCategories, displayStatus } from '../data/reportOptions';
import { city } from '../data/mockData';
import {citizenAction} from '../utils/citizenChanges';
export default function ReportFeed({ feed,onSelect,citizen=false }) {
  return <>
    <div className="page-heading">
      <p className="muted">{feed.total} reports · Latest first</p>
      <button className="secondary" disabled={feed.loading} onClick={() => feed.refresh()}>Refresh reports</button>
    </div>
    {feed.error && <p role="alert" className="error">{feed.error}</p>}
    {feed.loading && <p role="status" className="muted">Loading reports…</p>}
    {!feed.loading && !feed.error && !feed.reports.length && <p className="empty">No reports yet.</p>}
    <div className="report-grid">
      {feed.reports.map(report => <article className="report-card" key={report.id}>
        <div className="incident-top">
          <span className="eyebrow" title={report.id}>{report.id.slice(0, 8).toUpperCase()}</span>
          <span className={'status-pill ' + (report.status === 'resolved' ? 'resolved' : '')}>{displayStatus(report.status)}</span>
        </div>
        <h3>{report.title}</h3>
        <p>{report.description}</p>
        <p>{report.area || "Location not labeled"} · {reportCategories.find(category => category.id === report.category)?.label || report.category}</p>
        <small className="muted">
          {new Date(report.reported_at).toLocaleString('en-GB', { timeZone: city.timezone })}
          {report.priority && ' · ' + displayStatus(report.priority) + ' priority'}
        </small>
        <p className="muted">GPS: {report.latitude}, {report.longitude}{report.location_accuracy!=null && ' · accuracy ±'+report.location_accuracy+' m'}</p>
        {onSelect && <div className="evidence-actions">
          <button type="button" className="secondary" onClick={()=>onSelect(report.id)}>{citizen?'View Details':'View incident details'}</button>
          {citizen&&citizenAction(report.status)!=='View Details'&&<button type="button" className="secondary" onClick={()=>onSelect(report.id)}>{citizenAction(report.status)}</button>}
        </div>}
        <EvidenceViewer incidentId={report.id}/>
      </article>)}
    </div>
    {feed.reports.length < feed.total && <button disabled={feed.loading} onClick={() => feed.refresh(true)}>Load more reports</button>}
  </>;
}


