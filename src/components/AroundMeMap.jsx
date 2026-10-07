import {useEffect,useState} from 'react';
import {MapContainer,TileLayer,Rectangle,Popup,AttributionControl,useMap} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {city} from '../config/city';
import {cellCenter} from '../utils/aroundMe';
function Viewport({query}){const map=useMap();useEffect(()=>{map.setView(cellCenter(query),12);map.invalidateSize();},[map,query.row,query.column]);return null;}
export default function AroundMeMap({cells,query,onSelect,onAreaChange}){
  const [tileError,setTileError]=useState(false);
  return <div className="around-me-map">{tileError&&<p role="status">Basemap tiles are unavailable. Released report groups remain available below.</p>}<MapContainer center={cellCenter(query)} zoom={12} maxZoom={13} doubleClickZoom={false} scrollWheelZoom={false} attributionControl={false}>
    <AttributionControl position="bottomleft"/><TileLayer url={city.tileUrl} attribution={city.attribution} maxZoom={13} eventHandlers={{tileerror:()=>setTileError(true)}}/><Viewport query={query}/>
    {cells.map(cell=><Rectangle key={cell.cellId} bounds={cell.generalizedBounds} pathOptions={{color:'#228be6',weight:2,fillOpacity:0.2}} eventHandlers={{click:()=>onSelect(cell.cellId)}}><Popup><strong>Generalized report area</strong><p>These cells do not identify individual report locations.</p><button onClick={()=>onSelect(cell.cellId)}>View report groups</button></Popup></Rectangle>)}
    <AreaEvents onAreaChange={onAreaChange}/>
  </MapContainer></div>;
}
function AreaEvents({onAreaChange}){const map=useMap();useEffect(()=>{const choose=event=>onAreaChange(event.latlng.lat,event.latlng.lng);map.on('dblclick',choose);return()=>map.off('dblclick',choose);},[map,onAreaChange]);return null;}
