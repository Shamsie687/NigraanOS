import {useEffect,useState} from 'react';
import Brand from '../components/Brand';
import ReportFeed from '../components/ReportFeed';
import IncidentForm from '../components/IncidentForm';
import useReports from '../hooks/useReports';
import {city, alerts} from '../data/mockData';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import OperationsApplication from '../components/OperationsApplication';
import CitizenReportDetail from '../components/CitizenReportDetail';

export default function CitizenPage({session,operations,onSwitch,onRefreshAccess,operationsRequested,onExit}) {
  const [tab,setTab]=useState('home');
  const [busy,setBusy]=useState(false);
  const [success,setSuccess]=useState('');
  const [selected,setSelected]=useState(null);
  const feed=useReports(session.userId);
  useEffect(()=>{if(operationsRequested)setTab('account');},[operationsRequested]);
  async function saved(reference) {
    setSelected(null);
    setSuccess(reference);
    setTab('reports');
    await feed.refresh();
  }
  return <div className="citizen">
    <header className="citizen-header"><Brand/><span className="muted">{city.name} · Citizen portal</span><button className="text-button" disabled={busy} onClick={onExit}>Sign out ↗</button></header>
    <main className="citizen-main">
      <WorkspaceSwitcher workspace="citizen" operations={operations} onSwitch={onSwitch} onRefresh={onRefreshAccess} disabled={busy}/>
      <span className="eyebrow accent">YOUR CITY. YOUR VOICE.</span>
      <h1>Hello, {session.name}.</h1>
      <p className="muted">Help teams see what happened, where it happened, and the evidence.</p>
      <nav className="citizen-actions">
        {[['report','+','Report an incident'],['reports','▧','My reports']].map(([id,icon,label])=><button key={id} disabled={busy} className={(id==='report'?'citizen-report-primary ':'')+(tab===id?'selected':'')} onClick={()=>{setTab(id);setSuccess('')}}><span>{icon}</span>{label} →</button>)}
      </nav>
      <button className="secondary" disabled={busy} onClick={()=>setTab('account')}>{operations?'Operations access':'Apply for Operations Access'}</button>
      {success&&<div className="success submission-success" role="status"><strong>Report submitted</strong><p>Your incident and evidence were saved.</p><p className="report-reference">Reference: {success}</p><p>Status: {feed.reports.find(report=>report.id===success)?.status?.replaceAll('_',' ')||'Refreshing report status…'}</p><button disabled={busy||!feed.reports.some(report=>report.id===success)} onClick={()=>setSelected(feed.reports.find(report=>report.id===success))}>View report →</button></div>}
      {tab==='account'?<OperationsApplication operations={operations} onRefresh={onRefreshAccess}/>:tab==='report'?<IncidentForm userId={session.userId} onSaved={saved} onBusy={setBusy}/>:tab==='alerts'?<section className="citizen-panel">
        <h2>City alerts</h2><p className="muted">Demonstration advisories, not live safety information.</p>
        {alerts.map(a=><article className="alert-card" key={a.title}><span className="status-pill">{a.severity} · Demo</span><h3>{a.title}</h3><p>{a.detail}</p></article>)}
      </section>:<section className="citizen-panel">
        <h2>{tab==='home'?'Your recent incidents':'My reports'}</h2>
        <p className="muted">Your submitted incidents and private evidence, stored in Supabase.</p>
        <ReportFeed feed={feed} citizen onSelect={id=>{if(!busy)setSelected(feed.reports.find(report=>report.id===id));}}/>
        {selected&&<CitizenReportDetail key={selected.id} report={selected} userId={session.userId} onClose={()=>setSelected(null)} onChanged={feed.refresh} onBusy={setBusy}/>} 
      </section>}
      <footer className="citizen-footer">GPS and a photo are required · Voice is optional · Evidence stays private</footer>
    </main>
  </div>;
}
