const CONDITIONS={0:['☀','Clear sky'],1:['🌤','Mainly clear'],2:['⛅','Partly cloudy'],3:['☁','Overcast'],45:['≋','Fog'],48:['≋','Rime fog'],51:['☂','Light drizzle'],53:['☂','Moderate drizzle'],55:['☂','Dense drizzle'],56:['☂','Light freezing drizzle'],57:['☂','Dense freezing drizzle'],61:['☂','Slight rain'],63:['☂','Moderate rain'],65:['☂','Heavy rain'],66:['☂','Light freezing rain'],67:['☂','Heavy freezing rain'],71:['❄','Slight snow'],73:['❄','Moderate snow'],75:['❄','Heavy snow'],77:['❄','Snow grains'],80:['☂','Slight rain showers'],81:['☂','Moderate rain showers'],82:['☂','Violent rain showers'],85:['❄','Slight snow showers'],86:['❄','Heavy snow showers'],95:['ϟ','Thunderstorm'],96:['ϟ','Thunderstorm with slight hail'],99:['ϟ','Thunderstorm with heavy hail']};
export function weatherCondition(code){const [icon,label]=CONDITIONS[code]||['○','Condition unavailable'];return {icon,label};}
export function displayEnvironment(data,now=Date.now(),offline=false){
  if(!data)return null;
  const result={...data};
  for(const key of ['weather','air_quality']){
    const value=data[key];const maximum=(key==='weather'?2:6)*3600000;
    const valid=Date.parse(value?.valid_at),fetched=Date.parse(value?.fetched_at);
    result[key]=!value||value.status==='unavailable'||!Number.isFinite(valid)||!Number.isFinite(fetched)||now-valid>maximum||now-fetched>maximum?{status:'unavailable'}:{...value,status:offline||value.status==='stale'||now>=Date.parse(value.refresh_after)?'stale':'current'};
  }
  if(result.weather.status==='unavailable')result.rainfall_context=null;
  return result;
}
