import { lazy,Suspense,useEffect,useRef,useState } from 'react';
import EmergencyOperations from '../components/EmergencyOperations';
import ReportFeed from '../components/ReportFeed';
import useOperationalIncidents from '../hooks/useOperationalIncidents';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import NigraanAiPanel from '../components/NigraanAiPanel';
import {loadAiIncident} from '../services/nigraanAi';
import {requireSupabase} from '../services/supabase';
import OperationsAnalytics from '../components/OperationsAnalytics';
import { navigation, city } from '../data/mockData';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import IncidentDetail from '../components/IncidentDetail';
import IncidentMapSection from '../components/IncidentMapSection';
import RealPriorityIncidents from '../components/RealPriorityIncidents';
import CityEnvironmentPanel from '../components/CityEnvironmentPanel';
import useCityContext from '../hooks/useCityContext';
import CommandSummary from '../components/CommandSummary';
import CommandActivity from '../components/CommandActivity';
import IncidentInspector from '../components/IncidentInspector';
import {getSimulatorSession} from '../services/mcpSimulatorRuntime';
const NigraanAgent=lazy(()=>import('../components/NigraanAgent'));
export default function OperationsPage({
  session,
  operations,
  onSwitch,
  onRefreshAccess,
  onExit
}) {
  const feed = useOperationalIncidents();
  const [active, setActive] = useState(()=>getSimulatorSession().snapshot().status==='connected'?'Nigraan Agent':'Dashboard');
  const environment=useCityContext(city.id,active==='Dashboard'||active==='Live Map'||active==='Urgent Operations');
  const [filter, setFilter] = useState('all');
  const [selectedId,setSelectedId]=useState(null);
  const [fullDetails,setFullDetails]=useState(false);
  const [notice,setNotice]=useState('');
  const [aiSelected,setAiSelected]=useState(null);
  const detailRef=useRef(null);
  const aiSelectionVersion=useRef(0);
  useEffect(()=>()=>{aiSelectionVersion.current++;},[]);
  const selected=active==='Nigraan AI'?aiSelected:feed.reports.find(report=>report.id===selectedId);
  useEffect(()=>{if(selectedId&&(active!=='Dashboard'||fullDetails))detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'});},[selectedId,active,fullDetails]);
  function selectIncident(id){setSelectedId(id);setFullDetails(false);setNotice('');}
  async function selectAiIncident(id){const version=++aiSelectionVersion.current;setAiSelected(null);setSelectedId(null);setNotice('');try{const incident=await loadAiIncident(requireSupabase(),id);if(version===aiSelectionVersion.current){setAiSelected(incident);setSelectedId(id);}}catch(error){if(version===aiSelectionVersion.current)setNotice(error.message);}}
  async function updated() {
    setNotice('Incident status updated. Citizens can refresh My Reports to see the change.');
    await feed.refresh();
    if(active==='Nigraan AI'&&selectedId)await selectAiIncident(selectedId);
  }
  function navigate(label) {
    aiSelectionVersion.current++;
    setActive(label);
    setSelectedId(null);setNotice('');
    setFullDetails(false);
    setAiSelected(null);
    feed.refresh();
    setFilter(navigation.find(n => n[0] === label)?.[2] || 'all');
  }
  return <div className="app-container">
  <Sidebar active={active} onNavigate={navigate} onExit={onExit} />
  <div className="main-content">
    <TopBar session={session} realIncidents={active!=='Settings'}/>
    <WorkspaceSwitcher workspace="operations" operations={operations} onSwitch={onSwitch} onRefresh={onRefreshAccess}/>
    {active === 'Settings' ? <main className="dashboard">
      <h2>Workspace settings</h2>
      <section className="settings panel">
        <h3>Operations workspace</h3>
        <p>City: {city.name} · Timezone: {city.timezone}
        </p>
        <p>Access: verified Operations account. Report access is enforced by database policies.</p>
        <p>Authentication, incidents, workflow and map markers use Supabase. The geographic basemap uses OpenStreetMap. City Environment provides modeled Open-Meteo/CAMS context. Analytics uses authorized submitted incidents and published Citizen activity. Nigraan AI uses authorized incident facts.</p>
        <button className="secondary" onClick={onExit}>Sign out</button>
      </section>
    </main> : active === 'Nigraan AI' ? <main className="dashboard ai-page">
      {notice&&<p role="status">{notice}</p>}
      {selected&&<div ref={detailRef}><IncidentDetail key={selected.id} incident={selected} onClose={()=>{setAiSelected(null);setSelectedId(null);}} onUpdated={updated}/></div>}
      <NigraanAiPanel onSelect={selectAiIncident}/>
    </main> : active === 'Nigraan Agent' ? <Suspense fallback={<main className="dashboard" role="status">Loading Nigraan Agent…</main>}><NigraanAgent key={session.userId} accountId={session.userId} onView={navigate} onIncident={id=>{navigate('Citizen Reports');selectIncident(id);}}/></Suspense> : active === 'Urgent Operations' ? <EmergencyOperations key={session.userId} feed={feed} accountId={session.userId} environment={environment} selectedId={selectedId} onSelect={selectIncident} onClose={()=>setSelectedId(null)} onUpdated={updated} onNavigate={navigate}/> : active === 'Analytics' ? <OperationsAnalytics key={session.userId} feed={feed} accountId={session.userId} onSelect={id=>{navigate('Citizen Reports');selectIncident(id);}}/> : <main className={'dashboard operations-real-workspace'+(active==='Live Map'?' live-map-page':'')}>
      <div className="page-heading">
        <h2>{active==='Dashboard'?'Command Center':active==='Citizen Reports'?'Incidents':active==='Flood Risk'?'Flood reports':active==='Road Conditions'?'Road damage reports':active==='Live Map'?'Live Map':active}</h2>
        <span className="demo-tag">Authorized incident feed</span>
      </div>
      {active==='Dashboard'&&<CommandSummary incidents={feed.reports} loading={feed.loading} error={feed.error} asOf={feed.lastUpdated}/>}
      {(active==='Dashboard'||active==='Live Map')&&<CityEnvironmentPanel context={environment} city={city}/>}
      <div className="incident-data-status">
        <span role="status">{feed.loading?'Refreshing incidents…':feed.error?'Incident read unavailable':feed.total+' incidents'} · {['receiving','connected'].includes(feed.realtimeStatus)?'Live connection':feed.realtimeStatus==='connecting'?'Connecting…':'Automatic refresh active'}</span>
        <details className="connection-disclosure"><summary>Connection details</summary><p>Change channel: {feed.realtimeStatus} · 30s refresh backup</p>{feed.lastUpdated&&<small>Last successful read: {feed.lastUpdated.toLocaleTimeString('en-GB',{timeZone:city.timezone})} PKT</small>}</details>
        <button disabled={feed.loading} onClick={()=>feed.refresh()}>Refresh incidents</button>
      </div>
      {feed.error&&<p className="error" role="alert">{feed.error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {active==='Citizen Reports'?<ReportFeed feed={feed} onSelect={selectIncident}/>:<div className={active==='Dashboard'?'real-command-grid':'real-map-layout'}>
        <IncidentMapSection incidents={feed.reports} onSelect={selectIncident} category={filter} onCategoryChange={setFilter} large={active!=='Dashboard'} loading={feed.loading}/>
        {active==='Dashboard'&&<aside className="command-side">
          {selected&&<IncidentInspector key={selected.id} incident={selected} onClose={()=>setSelectedId(null)} onUpdated={updated} onFullDetails={()=>setFullDetails(true)}/>}
          <RealPriorityIncidents incidents={feed.reports} onSelect={selectIncident} loading={feed.loading}/>
          <section className="panel command-ai"><h3>✧ Nigraan AI</h3><p className="muted">Explore a grounded briefing of your authorized incidents.</p><button className="secondary" onClick={()=>navigate('Nigraan AI')}>Open Nigraan AI →</button></section>
        </aside>}
      </div>}
      {selected&&(active!=='Dashboard'||fullDetails)&&<div ref={detailRef}><IncidentDetail key={selected.id} incident={selected} onClose={()=>{setSelectedId(null);setFullDetails(false);}} onUpdated={updated}/></div>}
      {active==='Dashboard'&&<CommandActivity incidents={feed.reports} lastUpdated={feed.lastUpdated} onSelect={selectIncident}/>}
    </main>}
  </div>
</div>;
}

