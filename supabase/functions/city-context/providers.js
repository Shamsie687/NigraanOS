export const VERSION=1;
export const CITIES={karachi:{id:'karachi',name:'Karachi',timezone:'Asia/Karachi',context_coordinates:[24.8607,67.0011]}};
const iso=seconds=>new Date(seconds*1000).toISOString();
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function aqiCategory(value){return value===null?'Unavailable':value<=50?'Good':value<=100?'Moderate':value<=150?'Unhealthy for sensitive groups':value<=200?'Unhealthy':value<=300?'Very unhealthy':'Hazardous';}
export function rainfallPeriod(hourly,start,end){
  const values=new Map();const duplicates=new Set();
  (hourly?.time||[]).forEach((time,index)=>{if(values.has(time))duplicates.add(time);values.set(time,number(hourly.precipitation?.[index]));});
  let total=0,count=0;for(let time=start+3600;time<=end;time+=3600){const value=values.get(time);if(value!==null&&value!==undefined&&value>=0&&!duplicates.has(time)){total+=value;count++;}}
  return {start_at:iso(start),end_at:iso(end),coverage:count===24?'complete':'partial',hours_available:count,hours_expected:24,precipitation_mm:count===24?Math.round(total*100)/100:null};
}
function base(raw,provider,model,type,resolution){
  if(!raw?.current||number(raw.current.time)===null||number(raw.current.interval)===null||raw.current.interval<=0)throw new Error('Invalid provider time');
  if(raw.current_units?.time!=='unixtime'||raw.current_units?.interval!=='seconds')throw new Error('Unsupported time unit');
  if(number(raw.latitude)===null||number(raw.longitude)===null)throw new Error('Invalid provider grid');
  return {valid_at:iso(raw.current.time),interval_seconds:raw.current.interval,source:{provider,model,dataset_type:type,resolution_km:resolution,grid_coordinates:[raw.latitude,raw.longitude],attribution:model==='CAMS global'?'Open-Meteo · Copernicus CAMS':'Open-Meteo · weather model data'}};
}
function unit(raw,field,expected){if(raw.current_units?.[field]!==expected)throw new Error('Unsupported provider unit');}
export function normalizeWeather(raw){
  const b=base(raw,'Open-Meteo','Best available weather model','modeled_estimate',null);
  for(const [field,u] of Object.entries({temperature_2m:'°C',apparent_temperature:'°C',relative_humidity_2m:'%',wind_speed_10m:'km/h',precipitation:'mm',rain:'mm'}))unit(raw,field,u);
  if(raw.hourly_units?.precipitation!=='mm'||raw.hourly_units?.time!=='unixtime')throw new Error('Unsupported hourly unit');
  const c=raw.current;const temperature=number(c.temperature_2m);if(temperature===null)throw new Error('Missing temperature');
  const end=Math.floor(c.time/3600)*3600;
  return {...b,temperature_c:temperature,apparent_temperature_c:number(c.apparent_temperature),humidity_percent:number(c.relative_humidity_2m),weather_code:number(c.weather_code),wind_speed_kmh:number(c.wind_speed_10m),precipitation:{amount_mm:number(c.precipitation),interval_seconds:c.interval},rain:{amount_mm:number(c.rain),interval_seconds:c.interval},rainfall_context:{previous_24h:{...rainfallPeriod(raw.hourly,end-86400,end),source_type:'modeled_estimate'},next_24h:{...rainfallPeriod(raw.hourly,end,end+86400),source_type:'forecast'}}};
}
export function normalizeAir(raw){
  const b=base(raw,'Open-Meteo','CAMS global','model_grid_forecast',45);
  unit(raw,'us_aqi','USAQI');for(const field of ['pm2_5','pm10'])unit(raw,field,'μg/m³');
  const c=raw.current;const aqi=number(c.us_aqi);if(aqi===null||aqi<0)throw new Error('Missing AQI');
  return {...b,aqi,aqi_scale:'US AQI',aqi_category:aqiCategory(aqi),pm2_5_ug_m3:number(c.pm2_5),pm10_ug_m3:number(c.pm10),no2_ug_m3:raw.current_units.nitrogen_dioxide==='μg/m³'?number(c.nitrogen_dioxide):null,o3_ug_m3:raw.current_units.ozone==='μg/m³'?number(c.ozone):null};
}
export function providerUrl(city,dataset){
  const [latitude,longitude]=city.context_coordinates;
  const params=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),timezone:'GMT',timeformat:'unixtime'});
  if(dataset==='weather'){params.set('current','temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m');params.set('hourly','precipitation,rain,precipitation_probability');params.set('past_days','2');params.set('forecast_days','3');}
  else{params.set('current','us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone');params.set('domains','cams_global');}
  return (dataset==='weather'?'https://api.open-meteo.com/v1/forecast?':'https://air-quality-api.open-meteo.com/v1/air-quality?')+params;
}
export async function fetchDataset(city,dataset,{fetcher=fetch,timeoutMs=8000,now=Date.now}={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetcher(providerUrl(city,dataset),{signal:controller.signal});
    if(!response.ok){const header=response.headers.get('Retry-After');const seconds=Number(header);const date=Date.parse(header);const retryAfter=header&&Number.isFinite(seconds)?seconds:Number.isFinite(date)?Math.ceil((date-now())/1000):60;await response.body?.cancel();throw Object.assign(new Error('Provider unavailable'),{retryAfter:Math.min(86400,Math.max(30,retryAfter))});}
    const reader=response.body.getReader();let length=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>100000)throw new Error('Provider response too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const raw=JSON.parse(new TextDecoder().decode(bytes));return dataset==='weather'?normalizeWeather(raw):normalizeAir(raw);
  }finally{clearTimeout(timer);}
}
export function presentCache(row,dataset,now=Date.now()){
  const maxAge=(dataset==='weather'?2:6)*3600000;
  const age=now-Date.parse(row?.payload?.valid_at);const fetchAge=now-Date.parse(row?.fetched_at);
  if(!row?.payload||!Number.isFinite(age)||!Number.isFinite(fetchAge)||age< -900000||age>maxAge||fetchAge>maxAge)return {status:'unavailable'};
  return {...row.payload,fetched_at:row.fetched_at,refresh_after:row.refresh_after,status:Date.parse(row.refresh_after)>now&&!row.retry_after?'current':'stale'};
}
