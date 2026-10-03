import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CITIES,normalizeWeather,normalizeAir,rainfallPeriod,aqiCategory,fetchDataset,presentCache,providerUrl} from '../supabase/functions/city-context/providers.js';
import {createCityContextHandler} from '../supabase/functions/city-context/handler.js';
import {weatherCondition,displayEnvironment} from '../src/utils/cityEnvironment.js';
import {loadCityContext} from '../src/services/cityContext.js';
const fixture=async name=>JSON.parse((await readFile(new URL('./fixtures/city-context/karachi-'+name+'.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const weather=await fixture('weather'),air=await fixture('air');const now=weather.current.time*1000;
function harness(options={}){
  const rows={},calls=[],requests=[];let approvals=0;
  const client={auth:{getUser:async()=>options.signedOut?{error:true}:{data:{user:{id:'never-external'}}}},rpc:async()=>({data:options.denied?false:options.revoked&&++approvals>1?false:true})};
  const cache={claim:async(city,dataset)=>{calls.push(dataset);rows[dataset]||={lease:'test-lease'};return structuredClone(rows[dataset]);},finish:async(city,dataset,token,payload,retry)=>{calls.push({dataset,payload,retry});if(payload)rows[dataset]={payload,fetched_at:new Date(now).toISOString(),refresh_after:new Date(now+(dataset==='weather'?900000:3600000)).toISOString()};return true;}};
  const fetcher=async(url,init)=>{requests.push(url);if(options.timeout)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('timeout'))));if(options.weatherFail&&url.includes('/forecast')||options.airFail&&url.includes('/air-quality'))return new Response('private upstream',{status:429,headers:{'Retry-After':'120'}});return new Response(JSON.stringify(url.includes('/forecast')?weather:air));};
  const handler=createCityContextHandler({userClient:()=>client,cache,fetcher,now:()=>now,timeoutMs:5,allowedOrigins:()=> 'http://localhost:5173'});
  const request=(body={city_id:'karachi'},auth='Bearer private-jwt')=>new Request('http://local',{method:'POST',headers:{Authorization:auth,Origin:'http://localhost:5173'},body:JSON.stringify(body)});
  return {handler,request,rows,calls,requests};
}
test('real Karachi fixtures normalize units, times, model provenance and zero precipitation',()=>{
  const w=normalizeWeather(weather),a=normalizeAir(air);
  assert.equal(w.temperature_c,25.6);assert.equal(w.precipitation.amount_mm,0);assert.equal(w.precipitation.interval_seconds,900);assert.equal(w.valid_at,new Date(now).toISOString());
  assert.equal(w.rainfall_context.previous_24h.coverage,'complete');assert.equal(w.rainfall_context.next_24h.coverage,'complete');
  assert.equal(a.aqi,81);assert.equal(a.aqi_category,'Moderate');assert.equal(a.pm2_5_ug_m3,15.1);assert.equal(a.pm10_ug_m3,24);assert.equal(a.source.resolution_km,45);assert.equal(a.source.dataset_type,'model_grid_forecast');
  const bad=structuredClone(weather);bad.current_units.temperature_2m='F';assert.throws(()=>normalizeWeather(bad));bad.current_units.temperature_2m='°C';bad.current.time=null;assert.throws(()=>normalizeWeather(bad));
});
test('hourly sums use preceding-hour endpoints and reject gaps/nulls/duplicates, not genuine zeros',()=>{
  const hourly={time:Array.from({length:25},(_,i)=>i*3600),precipitation:Array(25).fill(1)};hourly.precipitation[0]=999;
  assert.equal(rainfallPeriod(hourly,0,86400).precipitation_mm,24);
  hourly.precipitation.fill(0);assert.equal(rainfallPeriod(hourly,0,86400).precipitation_mm,0);
  hourly.precipitation[5]=null;assert.equal(rainfallPeriod(hourly,0,86400).precipitation_mm,null);assert.equal(rainfallPeriod(hourly,0,86400).hours_available,23);
  hourly.precipitation[5]=0;hourly.time[5]=hourly.time[4];assert.equal(rainfallPeriod(hourly,0,86400).coverage,'partial');
  const w=structuredClone(weather);w.current.precipitation=null;assert.equal(normalizeWeather(w).precipitation.amount_mm,null);
});
test('weather code mapping and AQI boundaries are deterministic',()=>{
  assert.equal(weatherCondition(65).label,'Heavy rain');assert.equal(weatherCondition(0).label,'Clear sky');assert.equal(weatherCondition(999).label,'Condition unavailable');
  for(const [value,label] of [[50,'Good'],[51,'Moderate'],[100,'Moderate'],[101,'Unhealthy for sensitive groups'],[151,'Unhealthy'],[201,'Very unhealthy'],[301,'Hazardous'],[null,'Unavailable']])assert.equal(aqiCategory(value),label);
});
test('weather and AQ stale limits apply independently with valid-time and fetch-time checks',()=>{
  const row={payload:normalizeWeather(weather),fetched_at:new Date(now).toISOString(),refresh_after:new Date(now+900000).toISOString()};
  assert.equal(presentCache(row,'weather',now+899999).status,'current');assert.equal(presentCache(row,'weather',now+900000).status,'stale');assert.equal(presentCache(row,'weather',now+7200000).status,'stale');assert.equal(presentCache(row,'weather',now+7200001).status,'unavailable');
  const aq={...row,payload:normalizeAir(air),refresh_after:new Date(now+3600000).toISOString()};assert.equal(presentCache(aq,'air_quality',now+21600000).status,'stale');assert.equal(presentCache(aq,'air_quality',now+21600001).status,'unavailable');
  const data={weather:presentCache(row,'weather',now),air_quality:presentCache(aq,'air_quality',now),rainfall_context:{}};assert.equal(displayEnvironment(data,now,true).weather.status,'stale');assert.equal(displayEnvironment(data,now+7200001).weather.status,'unavailable');assert.equal(displayEnvironment(data,now+7200001).air_quality.status,'stale');
});
for(const options of [{signedOut:true},{denied:true}])test('unapproved authentication prevents cache/provider work '+JSON.stringify(options),async()=>{
  const h=harness(options);const response=await h.handler(h.request());assert.equal(response.status,options.signedOut?401:403);assert.equal(h.calls.length,0);assert.equal(h.requests.length,0);
});
test('missing auth, unknown cities and coordinate/provider injections are rejected',async()=>{
  const h=harness();assert.equal((await h.handler(h.request(undefined,''))).status,401);
  for(const input of [{city_id:'unknown'},{city_id:'karachi',latitude:24},{city_id:'karachi',provider:'http://evil'},null,[],{city_id:'karachi',question:'private report'}])assert.equal((await h.handler(h.request(input))).status,400);
  assert.equal(h.calls.length,0);assert.equal(h.requests.length,0);
});
test('approved response succeeds; outbound URLs contain geographic configuration only',async()=>{
  const h=harness();const response=await h.handler(h.request());const result=await response.json();assert.equal(response.status,200);assert.equal(result.context_only,true);assert.equal(result.weather.status,'current');assert.equal(result.air_quality.status,'current');
  assert.equal(response.headers.get('access-control-allow-origin'),'http://localhost:5173');
  for(const url of h.requests){assert.ok(!/private|jwt|never-external|report|evidence/.test(url));assert.equal(new URL(url).searchParams.get('latitude'),'24.8607');}
  assert.equal(new URL(providerUrl(CITIES.karachi,'air_quality')).searchParams.get('domains'),'cams_global');
  h.requests.length=0;await h.handler(h.request());assert.equal(h.requests.length,0);
});
test('provider failure is independent; last weather success is retained stale and Retry-After respected',async()=>{
  const h=harness({weatherFail:true});h.rows.weather={payload:normalizeWeather(weather),fetched_at:new Date(now-3600000).toISOString(),refresh_after:new Date(now-1000).toISOString(),lease:'test-lease'};
  const result=await (await h.handler(h.request())).json();assert.equal(result.weather.status,'stale');assert.equal(result.air_quality.status,'current');assert.equal(result.weather.temperature_c,25.6);
  const failure=h.calls.find(c=>c.dataset==='weather'&&typeof c==='object');assert.equal(failure.payload,null);assert.equal(failure.retry,120);assert.equal(h.rows.weather.payload.temperature_c,25.6);
});
test('provider timeout and approval revocation fail honestly',async()=>{
  const h=harness({timeout:true});const result=await (await h.handler(h.request())).json();assert.equal(result.weather.status,'unavailable');assert.equal(result.air_quality.status,'unavailable');
  const revoked=harness({revoked:true});assert.equal((await revoked.handler(revoked.request())).status,403);
});
test('AQ failure leaves weather and rainfall usable; pending/rejected callers cannot fetch',async()=>{
  const h=harness({airFail:true});const data=await (await h.handler(h.request())).json();assert.equal(data.weather.status,'current');assert.equal(data.air_quality.status,'unavailable');assert.equal(data.rainfall_context.previous_24h.coverage,'complete');
  for(const status of ['pending','rejected']){const denied=harness({denied:true});assert.equal((await denied.handler(denied.request())).status,403,status);assert.equal(denied.requests.length,0);}
});
test('429 HTTP-date Retry-After parsed without exposing provider body',async()=>{
  await assert.rejects(()=>fetchDataset(CITIES.karachi,'weather',{now:()=>now,fetcher:async()=>new Response('sensitive body',{status:429,headers:{'Retry-After':new Date(now+120000).toUTCString()}})}),error=>error.retryAfter===120&&!error.message.includes('sensitive'));
});
test('frontend only invokes city-context with city id; no demo fallback',async()=>{
  const h=harness();const body=await (await h.handler(h.request())).json();const client={functions:{invoke:async(name,{body:input})=>{assert.equal(name,'city-context');assert.deepEqual(input,{city_id:'karachi'});return {data:body};}}};assert.equal((await loadCityContext(client,'karachi')).weather.temperature_c,25.6);
  await assert.rejects(()=>loadCityContext({functions:{invoke:async()=>({error:true})}},'karachi'),/unavailable/);
});
