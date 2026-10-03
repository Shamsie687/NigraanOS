import {weatherCondition} from '../utils/cityEnvironment';
const number=(value,unit='')=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-GB',{maximumFractionDigits:1})+unit:'Unavailable';
function date(value,timezone){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('en-GB',{timeZone:timezone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+' · '+timezone:'Unavailable';}
function State({value}){return <span className={'environment-state state-'+(value?.status||'unavailable')}>{value?.status||'unavailable'}</span>;}
function Source({value,timezone}){return <p className="environment-source">Data valid at {date(value.valid_at,timezone)}<br/>Fetched {date(value.fetched_at,timezone)}<br/>{value.source?.attribution}</p>;}
function Period({label,period,timezone}){return <div className="rainfall-period"><span>{label}</span><strong>{period?.coverage==='complete'?number(period.precipitation_mm,' mm'):'Unavailable · partial coverage'}</strong>{period&&<small>{date(period.start_at,timezone)} → {date(period.end_at,timezone)} · {period.hours_available}/{period.hours_expected} hourly intervals</small>}</div>;}
export default function CityEnvironmentPanel({context,city}){
  const {data,loading,error,refresh}=context;const weather=data?.weather,air=data?.air_quality;const timezone=city.timezone;
  const content=<>
    <div className="environment-toolbar"><p>{city.name} context point · {city.center.join(', ')} · Modeled external data</p><button className="secondary" disabled={loading} onClick={refresh}>{loading?'Refreshing…':'Refresh environment'}</button></div>
    {error&&<p role="status" className="muted">Refresh unavailable. Any retained values are marked stale.</p>}
    <div className="environment-grid">
      <article className="environment-card"><div className="environment-title"><h4>Weather</h4><State value={weather}/></div>
        {weather&&weather.status!=='unavailable'?<><strong className="environment-headline">{number(weather.temperature_c,' °C')}</strong><p>{weatherCondition(weather.weather_code).icon} {weatherCondition(weather.weather_code).label}</p><p>Feels like {number(weather.apparent_temperature_c,' °C')}<br/>Humidity {number(weather.humidity_percent,'%')} · Wind {number(weather.wind_speed_kmh,' km/h')}</p><Source value={weather} timezone={timezone}/></>:<p>{loading?'Loading weather…':'Environmental data unavailable.'}</p>}
      </article>
      <article className="environment-card"><div className="environment-title"><h4>Rainfall context</h4><State value={weather}/></div>
        {weather&&weather.status!=='unavailable'?<><p>Current precipitation <strong>{number(weather.precipitation.amount_mm,' mm')}</strong> over {number(weather.precipitation.interval_seconds/60,' minutes')}<br/>Rain component {number(weather.rain.amount_mm,' mm')}</p><Period label="Previous 24h · modeled estimate" period={data.rainfall_context?.previous_24h} timezone={timezone}/><Period label="Next 24h · forecast" period={data.rainfall_context?.next_24h} timezone={timezone}/><Source value={weather} timezone={timezone}/></>:<p>{loading?'Loading rainfall context…':'Environmental data unavailable.'}</p>}
        <p className="environment-source">Rainfall context does not confirm flooding.</p>
      </article>
      <article className="environment-card"><div className="environment-title"><h4>Air quality · Modeled</h4><State value={air}/></div>
        {air&&air.status!=='unavailable'?<><strong className="environment-headline">US AQI {number(air.aqi)}</strong><p>{air.aqi_category}</p><p>PM2.5 {number(air.pm2_5_ug_m3,' µg/m³')}<br/>PM10 {number(air.pm10_ug_m3,' µg/m³')}</p><details><summary>Pollutant details</summary><p>NO2 {number(air.no2_ug_m3,' µg/m³')}<br/>O3 {number(air.o3_ug_m3,' µg/m³')}</p></details><p className="environment-source">CAMS global · Approx. 45 km model grid · Not a sensor or citywide measured average</p><Source value={air} timezone={timezone}/></>:<p>{loading?'Loading air quality…':'Environmental data unavailable.'}</p>}
      </article>
    </div>
    <p className="environment-disclaimer">Environmental context does not verify Citizen reports. Values remain tied to the configured context point when the map is moved.</p>
    <p className="environment-attribution">Sources: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noreferrer">Copernicus CAMS</a></p>
  </>;
  return <section className="panel city-environment environment-compact" aria-label="City Environment">
    <details className="environment-collapsible"><summary><span className="environment-summary-title">City Conditions · Modeled</span><span className="environment-summary-values">
      <span><b>Weather</b> {weather&&weather.status!=='unavailable'?number(weather.temperature_c,' °C')+' · '+weatherCondition(weather.weather_code).label:loading?'Loading…':'Unavailable'} <State value={weather}/></span>
      <span><b>Precipitation</b> {weather&&weather.status!=='unavailable'?number(weather.precipitation.amount_mm,' mm')+' / '+number(weather.precipitation.interval_seconds/60,' min'):'Unavailable'}</span>
      <span><b>US AQI</b> {air&&air.status!=='unavailable'?number(air.aqi)+' · '+air.aqi_category:loading?'Loading…':'Unavailable'} <State value={air}/></span>
    </span><span className="environment-expand-hint">View details</span></summary>{content}</details>
    <p className="environment-compact-provenance">Weather: Open-Meteo · Valid {date(weather?.valid_at,timezone)} · Fetched {date(weather?.fetched_at,timezone)}<br/>Air: CAMS via Open-Meteo · Valid {date(air?.valid_at,timezone)} · Fetched {date(air?.fetched_at,timezone)}</p>
    <p className="environment-disclaimer">Modeled context, not verified incident evidence or a flood warning.</p>
  </section>;
}
