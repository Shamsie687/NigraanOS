import {useState} from 'react';
import useNigraanAi from '../hooks/useNigraanAi';
import {reportCategories,displayStatus} from '../data/reportOptions';
export const AI_CHIPS=[['Current briefing','Summarize the current situation.','briefing','all'],['What needs attention?','What needs attention based on recorded priority and unresolved age?','unresolved','all'],['Recent Citizen updates','What Citizen activity was published recently?','recent','all'],['Longest waiting','Which unresolved incidents have been waiting longest since reporting?','longest','all'],['Road damage overview','What are the main road damage reports?','unresolved','road_damage'],['Garbage overview','What are the main garbage reports?','unresolved','garbage']];
export function ageLabel(seconds){if(seconds===null||seconds===undefined)return 'None';if(seconds<3600)return Math.floor(seconds/60)+' min';if(seconds<86400)return Math.floor(seconds/3600)+' hr';return Math.floor(seconds/86400)+' days';}
export function NigraanAiView({result,loading,onGenerate,onSelect}) {
  const [question,setQuestion]=useState(AI_CHIPS[0][1]),[scope,setScope]=useState('briefing'),[category,setCategory]=useState('all'),[activityHours,setActivityHours]=useState(24),[lastInput,setLastInput]=useState(null);
  const snapshot=result?.snapshot,answer=result?.answer,error=result?.error;
  const hasValidatedBullets=Boolean(answer&&(answer.interpretation.length||answer.suggestions.length));
  function generate(){const input={question,scope,category,activityHours};setLastInput(input);onGenerate(input);}
  const incidentFor=alias=>snapshot?.incidents.find(i=>i.alias===alias)||snapshot?.incidents.find(i=>i.id===snapshot.activity.find(a=>a.alias===alias)?.incident_id);
  const citations=refs=>refs.map(alias=>{const incident=incidentFor(alias);return incident?<button key={alias} className="text-button ai-citation" onClick={()=>onSelect(incident.id)}>{alias} · View incident</button>:null;});
  return <section className="nigraan-ai panel">
    <div className="panel-header"><h2>Nigraan AI</h2><span className="demo-tag">Read-only decision support</span></div>
    <p>Fresh facts from incidents available to this authenticated Operations workspace. AI interpretation supports human review.</p>
    <p className="muted">Citizen report text, transcripts and media are excluded from AI context in this release. Recent activity describes published edits and updates, not their text.</p>
    <p className="muted">Ask about recorded signals. Do not enter Citizen names, addresses or contact details in your question.</p>
    <div className="ai-question-chips">{AI_CHIPS.map(([label,text,mode,filter])=><button key={label} disabled={loading} className="secondary" onClick={()=>{setQuestion(text);setScope(mode);setCategory(filter);}}>{label}</button>)}</div>
    <form onSubmit={event=>{event.preventDefault();generate();}} className="ai-question-form">
      <label>Question<textarea value={question} onChange={event=>setQuestion(event.target.value)} maxLength={600} required disabled={loading} placeholder="Ask about the available incident snapshot"/></label>
      <div className="ai-filter-row">
        <label>Scope<select value={scope} disabled={loading} onChange={event=>setScope(event.target.value)}><option value="briefing">Current briefing</option><option value="unresolved">Unresolved incidents</option><option value="recent">Recent Citizen activity</option><option value="longest">Longest waiting</option></select></label>
        <label>Category<select value={category} disabled={loading} onChange={event=>setCategory(event.target.value)}><option value="all">All categories</option>{reportCategories.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Citizen activity window<select value={activityHours} disabled={loading} onChange={event=>setActivityHours(Number(event.target.value))}><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option><option value={720}>Last 30 days</option></select></label>
      </div>
      <div className="ai-actions"><button disabled={loading||!question.trim()} type="submit">{loading?'Generating briefing…':'Generate'}</button>{lastInput&&<button type="button" className="secondary" disabled={loading} onClick={()=>onGenerate(lastInput)}>Regenerate</button>}</div>
    </form>
    {loading&&<p role="status">Reading authorized incident facts and requesting an AI briefing…</p>}
    {error&&<div role="alert" className="error"><p>{error.message}</p>{error.retryAfter>0&&<p>Try again in about {Math.ceil(error.retryAfter/60)} minute(s).</p>}{snapshot&&<p>AI briefing unavailable. Current incident facts are shown.</p>}</div>}
    {snapshot&&<>
      <p className="ai-snapshot muted">Snapshot: {new Date(snapshot.snapshotAt).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})} PKT · Scope: {displayStatus(snapshot.scope.mode)} · Category: {displayStatus(snapshot.scope.category)} · Activity window: {snapshot.scope.activityHours} hours</p>
      <p className="muted">{snapshot.facts.matchingCount} matching incidents · {snapshot.includedCount} supporting records included · {snapshot.omittedCount} incident details omitted. {snapshot.includedActivityCount} activity records included · {snapshot.omittedActivityCount} activity details omitted.</p>
      <h3>Facts from NigraanOS</h3>
      <div className="ai-fact-grid">{[['Matching incidents',snapshot.facts.matchingCount],['Unresolved',snapshot.facts.unresolvedCount],['Oldest unresolved · since reported',ageLabel(snapshot.facts.oldestUnresolvedSeconds)],['Recent Citizen updates',snapshot.facts.recentUpdateCount],['Recent Citizen edits',snapshot.facts.recentEditCount]].map(([label,value])=><article key={label} className="ai-fact"><span>{label}</span><strong>{value}</strong></article>)}</div>
      <p>Categories: {Object.entries(snapshot.facts.categories).map(([name,count])=>displayStatus(name)+': '+count).join(' · ')||'None'}</p>
      <p>Recorded statuses: {Object.entries(snapshot.facts.statuses).map(([name,count])=>displayStatus(name)+': '+count).join(' · ')||'None'}</p>
      {answer&&<>{hasValidatedBullets&&result.answer_validation?.status==='partial'&&<p className="verification-note" role="status">Some AI-generated statements were omitted because they could not be validated against NigraanOS data.</p>}{!hasValidatedBullets?<p className="verification-note" role="status">No validated AI interpretation is available for this snapshot.</p>:<><h3>AI Interpretation</h3>{answer.interpretation.map((bullet,index)=><div key={index} className="ai-paragraph"><p>{bullet.text}</p>{citations(bullet.refs)}</div>)}<h3>Suggested Next Steps</h3>{answer.suggestions.map((bullet,index)=><div key={index} className="ai-paragraph"><p>{bullet.text}</p>{citations(bullet.refs)}</div>)}</>}{answer.limitations&&<p className="verification-note">{answer.limitations}</p>}</>}
      <h3>Supporting Incidents</h3>
      <div className="ai-supporting">{snapshot.incidents.map(incident=><article key={incident.id} className="ai-incident"><h4>{incident.alias} · {incident.title}</h4><p>{displayStatus(incident.category)} · {displayStatus(incident.status)} · Recorded priority: {displayStatus(incident.priority)} · Age since reported: {ageLabel(incident.age_seconds)}</p><button className="text-button" onClick={()=>onSelect(incident.id)}>View Incident →</button></article>)}</div>
      {!snapshot.incidents.length&&<p>No supporting incident details in this snapshot.</p>}
      {!!snapshot.activity.length&&<><h3>Published Citizen activity</h3>{snapshot.activity.map(activity=><p key={activity.id}>{activity.alias} · {displayStatus(activity.kind)} · {new Date(activity.published_at).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})} PKT{activity.changed_fields?.length?' · Changed fields: '+activity.changed_fields.join(', '):''} {citations([activity.alias])}</p>)}</>}
      <p className="verification-note">Recorded priority and report age are factual signals, not verified urgency. No dispatch, verification or workflow action is performed by Nigraan AI. This is a dated snapshot; regenerate for fresh data.</p>
    </>}
  </section>;
}
export default function NigraanAiPanel({onSelect}){const ai=useNigraanAi();return <NigraanAiView result={ai.result} loading={ai.loading} onGenerate={ai.generate} onSelect={onSelect}/>;}
