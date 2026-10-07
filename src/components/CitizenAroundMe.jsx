import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {city} from '../config/city';
import {reportCategories} from '../data/reportOptions';
import {generalizeLocation,filterAroundMe,privacyCopy,statusCopy,publicWorkflowLabels} from '../utils/aroundMe';
import useAroundMe from '../hooks/useAroundMe';
const Map=lazy(()=>import('./AroundMeMap'));
export default function CitizenAroundMe({userId}){
  const [query,setQuery]=useState(()=>generalizeLocation(...city.center)),[category,setCategory]=useState('all'),[workflow,setWorkflow]=useState('all'),[selected,setSelected]=useState(null),[locationError,setLocationError]=useState(''),[locating,setLocating]=useState(false);
  const alive=useRef(false),locationRequest=useRef(0);useEffect(()=>{alive.current=true;return()=>{alive.current=false;locationRequest.current++;};},[]);
  const feed=useAroundMe(userId,query),cells=filterAroundMe(feed.data?.cells||[],category,workflow);
  function chooseArea(lat,lng){try{setQuery(generalizeLocation(lat,lng));setSelected(null);setLocationError('');}catch{setLocationError('Choose an area inside Around Me coverage.');}}
  function myLocation(){if(!navigator.geolocation){setLocationError('Location is unavailable. You can still browse the default area.');return;}setLocating(true);setLocationError('');const request=++locationRequest.current;navigator.geolocation.getCurrentPosition(position=>{if(!alive.current||request!==locationRequest.current)return;chooseArea(position.coords.latitude,position.coords.longitude);setLocating(false);},()=>{if(!alive.current||request!==locationRequest.current)return;setLocating(false);setLocationError('Location could not be obtained. You can still browse the default area.');},{enableHighAccuracy:false,timeout:10000,maximumAge:60000});}
  return <section className="citizen-panel around-me" aria-label="Around Me"><h2>Around Me</h2><p>{privacyCopy}</p><p className="verification-note">{statusCopy}</p><p className="muted">Generalized areas, approximately 2 km across. No individual incident lookup. Double-click the map to choose a general area.</p>
    <div className="around-me-controls"><button className="secondary" disabled={locating} onClick={myLocation}>{locating?'Finding general area…':'My Location'}</button><button disabled={feed.loading} onClick={feed.refresh}>Refresh</button><label>Category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All released categories</option>{reportCategories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label>Recorded workflow<select value={workflow} onChange={e=>setWorkflow(e.target.value)}><option value="all">All released workflow groups</option>{Object.entries(publicWorkflowLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
    <p className="muted">Location is optional. Only your generalized area is sent to NigraanOS; it is not saved in request state. The basemap provider receives tile requests for the viewed area.</p>
    {locationError&&<p role="alert">{locationError}</p>}{feed.error&&<p role="alert">{feed.error}</p>}{feed.loading&&<p role="status">Loading privacy-screened groups…</p>}
    <AroundMeResults feed={feed} cells={cells}/>
    <Suspense fallback={<p role="status">Loading map…</p>}><Map cells={cells} query={query} onSelect={setSelected} onAreaChange={chooseArea}/></Suspense>
    <AroundMeCards cells={cells} selected={selected}/>
  </section>;
}
export function AroundMeResults({feed,cells}){return <>{feed.data&&<p>Snapshot day: {feed.data.snapshotDay} · Report starts in the 30 days before that day · Recorded workflow at snapshot preparation. Updates are daily.</p>}{!feed.loading&&feed.data&&!cells.length&&<p role="status">No report groups are available here under the current privacy rules and selected filters.</p>}</>;}
export function AroundMeCards({cells,selected}){return <div className="around-me-cards">{cells.map(cell=><article key={cell.cellId} className={selected===cell.cellId?'selected':''}><h3>Generalized area {cell.cellId}</h3>{cell.groups.map(group=><p key={group.category+group.publicWorkflowState}>{reportCategories.find(c=>c.id===group.category)?.label} · {publicWorkflowLabels[group.publicWorkflowState]} · {group.reportCountBand} reports</p>)}</article>)}</div>;}
