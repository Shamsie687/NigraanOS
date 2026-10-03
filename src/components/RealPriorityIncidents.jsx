import {reportCategories,displayStatus} from '../data/reportOptions';
import {prioritizeIncidents,markerPresentation} from '../utils/incidentMap';
export default function RealPriorityIncidents({incidents,onSelect,loading}) {
  const priority=prioritizeIncidents(incidents,3);
  return <section className="incidents-panel real-priority">
    <div className="panel-header"><h3>Needs Attention</h3><span className="demo-tag">Unresolved</span></div>
    <p className="muted priority-explanation">Recorded priority first · Newest within each priority</p>
    <div className="incidents-list">
      {priority.map(incident=><article className="incident-item" key={incident.id} style={{borderColor:markerPresentation(incident).color}}>
        <div className="incident-top"><small>{reportCategories.find(category=>category.id===incident.category)?.label || incident.category}</small><span className={'incident-priority priority-'+markerPresentation(incident).urgency}>{displayStatus(incident.priority)}</span></div>
        <h4>{incident.title}</h4><p className="incident-location">{incident.area || 'Area not labeled'}</p>
        <p>{displayStatus(incident.status)}</p><button className="text-button" onClick={()=>onSelect(incident.id)}>View incident →</button>
      </article>)}
      {!priority.length && <p className="empty">{loading?'Loading real incidents…':'No unresolved real incidents.'}</p>}
    </div>
  </section>;
}
