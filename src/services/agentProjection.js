import {DOMAINS,timestamp} from '../utils/operationsAnalytics.js';
export function projectAgentIncident(row,ref,to){
  const domain=(key,value)=>DOMAINS[key].includes(value)?value:'unknown';
  const at=timestamp(row.reported_at);
  return {ref,category:domain('category',row.category),status:domain('status',row.status),priority:domain('priority',row.priority),ageHours:at!==null&&at<=to?(to-at)/3600000:null};
}
// Fixed projection shared by browser and server; never serialize provider objects.
export function projectAgentConditions(data){
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  const stamp=value=>timestamp(value)!==null?value:null;
  const part=(value,kind)=>({status:['current','stale','unavailable'].includes(value?.status)?value.status:'unavailable',validAt:stamp(value?.valid_at),fetchedAt:stamp(value?.fetched_at),source:kind==='weather'?'Open-Meteo · modeled weather':'CAMS global via Open-Meteo · modeled AQ · approximately 45 km',...(kind==='weather'?{temperatureC:number(value?.temperature_c),precipitationMm:number(value?.precipitation?.amount_mm),intervalSeconds:number(value?.precipitation?.interval_seconds)}:{aqi:number(value?.aqi)})});
  return {city:'Karachi',weather:part(data.weather,'weather'),air:part(data.air_quality,'air'),disclaimer:'Modeled context does not verify incident severity or confirm flooding.'};
}
