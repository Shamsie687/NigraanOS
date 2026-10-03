import {useEffect,useMemo,useRef,useState} from 'react';
import {divIcon} from 'leaflet';
import {MapContainer,TileLayer,Marker,Popup,CircleMarker,Circle,Tooltip,AttributionControl,useMap} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {city as defaultCity} from '../config/city';
import {reportCategories,displayStatus} from '../data/reportOptions';
import {incidentWorkflow} from '../utils/workspaceAccess';
import {categoryStyles,filterMapIncidents,hasValidCoordinates,markerPresentation} from '../utils/incidentMap';

const icons=new Map();
function incidentIcon(incident,exactPriority=false) {
  const style=markerPresentation(exactPriority&&!['critical','high'].includes(incident.priority)?{...incident,priority:'normal'}:incident);
  const key=[style.category,style.urgency,style.resolved].join('-');
  if(!icons.has(key)) icons.set(key,divIcon({
    className:'incident-map-icon',iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-15],
    // Only fixed, allowlisted category/priority values enter icon HTML. Incident
    // titles/descriptions are rendered by React in the popup, never interpolated.
    html:`<span class="nigraan-pin pin-${style.category} urgency-${style.urgency}${style.resolved?' pin-resolved':''}">${style.symbol}</span>`,
  }));
  return icons.get(key);
}
function MapViewport({action}) {
  const map=useMap();
  useEffect(()=>{
    let frame;
    const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>map.invalidateSize({pan:false}));};
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(resize);
    observer?.observe(map.getContainer());window.addEventListener('resize',resize);resize();
    return ()=>{observer?.disconnect();window.removeEventListener('resize',resize);cancelAnimationFrame(frame);};
  },[map]);
  useEffect(()=>{
    if(!action)return;
    if(action.type==='fit')map.fitBounds(action.positions,{padding:[30,30],maxZoom:15});
    else map.setView(action.position,action.zoom);
  },[map,action]);
  return null;
}
export default function IncidentMap({incidents,onSelect,city=defaultCity,large=false,category='all',onCategoryChange,loading=false,externalFilters=false,fitLabel='Fit incidents',selectedId=null}) {
  const [localCategory,setLocalCategory]=useState(category);
  const [status,setStatus]=useState('all');
  const [action,setAction]=useState(null);
  const [location,setLocation]=useState(null);
  const [locating,setLocating]=useState(false);
  const [locationError,setLocationError]=useState('');
  const [tileError,setTileError]=useState(false);
  const [tileRevision,setTileRevision]=useState(0);
  const alive=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>setLocalCategory(category),[category]);
  const currentCategory=onCategoryChange?category:localCategory;
  const filtered=useMemo(()=>filterMapIncidents(incidents,{category:currentCategory,status}),[incidents,currentCategory,status]);
  const invalid=incidents.filter(incident=>!hasValidCoordinates(incident)).length;
  const changeCategory=value=>{setLocalCategory(value);onCategoryChange?.(value);};
  useEffect(()=>{const selected=incidents.find(i=>i.id===selectedId);if(selected&&hasValidCoordinates(selected))setAction({type:'selection',position:[selected.latitude,selected.longitude],zoom:15});},[selectedId]);
  function myLocation() {
    setLocationError('');
    if(!navigator.geolocation){setLocationError('Location is unavailable in this browser.');return;}
    setLocating(true);
    navigator.geolocation.getCurrentPosition(result=>{
      if(!alive.current)return;
      const point={latitude:result.coords.latitude,longitude:result.coords.longitude};
      if(!hasValidCoordinates(point)){setLocationError('The browser returned an invalid location.');setLocating(false);return;}
      setLocation({...point,accuracy:Number.isFinite(result.coords.accuracy)&&result.coords.accuracy>=0?result.coords.accuracy:0});
      setAction({type:'location',position:[point.latitude,point.longitude],zoom:15});setLocating(false);
    },cause=>{
      if(!alive.current)return;
      setLocating(false);setLocationError(cause.code===1?'Location permission was denied. You can still use the map.':'Unable to obtain your location. Check device location settings.');
    },{enableHighAccuracy:true,maximumAge:60000,timeout:10000});
  }
  return <section className={'map-panel real-map-panel'+(large?' map-expanded':'')} aria-label="Real citizen incident map">
    <div className="panel-header"><div><span className="eyebrow accent">CITIZEN INCIDENTS · REAL</span><h3>{city.name} incident map</h3></div><span className="demo-tag">OpenStreetMap</span></div>
    <div className="map-toolbar">{!externalFilters&&<div className="map-filter-controls">
      <label>Category<select value={currentCategory} onChange={event=>changeCategory(event.target.value)}><option value="all">All Incidents</option>{reportCategories.map(item=><option key={item.id} value={item.id}>{item.id==='power'?'Power':item.label}</option>)}</select></label>
      <label>Workflow<select value={status} onChange={event=>setStatus(event.target.value)}><option value="all">All statuses</option>{incidentWorkflow.map(value=><option key={value} value={value}>{displayStatus(value)}</option>)}</select></label>
    </div>}
    <div className="map-actions">
      <button title={'Center on '+city.name} onClick={()=>setAction({type:'center',position:city.center,zoom:city.zoom})}>Center</button>
      <button title="Fit filtered incidents" disabled={!filtered.length} onClick={()=>setAction({type:'fit',positions:filtered.map(incident=>[incident.latitude,incident.longitude])})}>{fitLabel}</button>
      <button disabled={locating} onClick={myLocation}>{locating?'Locating…':'My Location'}</button>
    </div>
    </div>
    {locationError&&<p className="error map-message" role="alert">{locationError}</p>}
    {tileError&&<p className="notice map-message" role="status">Some map tiles could not load. Incident data remains available. <button onClick={()=>{setTileError(false);setTileRevision(value=>value+1);}}>Retry tiles</button></p>}
    <div className="incident-map-frame">
      <MapContainer center={city.center} zoom={city.zoom} maxZoom={city.maxZoom} scrollWheelZoom={false} attributionControl={false} className="incident-leaflet-map" aria-label="Interactive incident map">
        <AttributionControl position="bottomleft"/>
        <TileLayer key={tileRevision} url={city.tileUrl} attribution={city.attribution} maxZoom={city.maxZoom} eventHandlers={{tileerror:()=>setTileError(true)}}/>
        <MapViewport action={action}/>
        {filtered.map(incident=><Marker key={incident.id} position={[incident.latitude,incident.longitude]} icon={incidentIcon(incident,externalFilters)} title={incident.title} riseOnHover eventHandlers={{add:({target})=>target.getElement()?.setAttribute('aria-label',incident.title+' · Incident marker')}}>
          <Popup><div className="incident-map-popup">
            <span className="eyebrow">REAL CITIZEN INCIDENT</span><h3>{incident.title}</h3>
            <p>{reportCategories.find(item=>item.id===incident.category)?.label || incident.category} · {incident.area || 'Area not labeled'}</p>
            <p>{displayStatus(incident.status)} · Recorded priority: {displayStatus(incident.priority)}</p>
            <p>{new Date(incident.reported_at).toLocaleString('en-GB',{timeZone:city.timezone})} · {city.timezone}</p>
            <button onClick={()=>onSelect(incident.id)}>View incident</button>
          </div></Popup>
        </Marker>)}
        {location&&<><CircleMarker center={[location.latitude,location.longitude]} radius={5} pathOptions={{color:'#fff',fillColor:'#228be6',fillOpacity:1}}><Tooltip>Your location · one-time fix</Tooltip></CircleMarker>{location.accuracy>0&&<Circle center={[location.latitude,location.longitude]} radius={location.accuracy} pathOptions={{color:'#228be6',weight:1,fillOpacity:0.08}}/>}</>}
      </MapContainer>
    </div>
    <details className="map-legend-details"><summary>Marker legend · Category color, priority ring · Faded = resolved</summary><div className="map-legend" aria-label="Marker legend">{reportCategories.map(item=><span key={item.id}><i style={{background:categoryStyles[item.id].color}}/>{item.id==='power'?'Power':item.label}</span>)}<span>Double ring: critical · Red ring: high · Faded: resolved</span></div></details>
    <p className="map-message muted" role="status">{loading?'Refreshing real incidents…':filtered.length+' markers for current filters'}{invalid>0?' · '+invalid+' incidents omitted from map: invalid/missing GPS':''}{!loading&&!filtered.length?' · No incidents match these filters.':''}</p>
  </section>;
}
