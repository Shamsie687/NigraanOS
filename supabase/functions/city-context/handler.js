import {CITIES,VERSION,fetchDataset,presentCache} from './providers.js';
export function createCityContextHandler({userClient,cache,allowedOrigins,fetcher=fetch,now=Date.now,timeoutMs=8000}){
  return async request=>{
    const origin=request.headers.get('Origin');const allowed=allowedOrigins().split(',').map(s=>s.trim()).filter(Boolean);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin&&allowed.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'});
    const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    try{
      if(origin&&!allowed.includes(origin))return respond(403,{error:'Application origin unavailable.'});
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(request.method!=='POST')return respond(405,{error:'Use POST.'});
      const authorization=request.headers.get('Authorization')||'';if(!/^Bearer \S+$/i.test(authorization))return respond(401,{error:'Sign in required.'});
      const client=userClient(authorization);const identity=await client.auth.getUser();if(identity.error||!identity.data?.user)return respond(401,{error:'Sign in required.'});
      const approved=await client.rpc('is_approved_operations');if(approved.error||approved.data!==true)return respond(403,{error:'Approved Operations access required.'});
      const reader=request.body?.getReader();if(!reader)return respond(400,{error:'Invalid city request.'});
      let text='';const decoder=new TextDecoder();let bytes=0;try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>256)return respond(400,{error:'Invalid city request.'});text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
      let input;try{input=JSON.parse(text);}catch{return respond(400,{error:'Invalid city request.'});}
      if(!input||Array.isArray(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'city_id')||typeof input.city_id!=='string'||!Object.hasOwn(CITIES,input.city_id))return respond(400,{error:'Unsupported city request.'});
      const city=CITIES[input.city_id];
      async function load(dataset){
        let row;try{
          row=await cache.claim(city.id,dataset);
          if(row.lease){
            try{const payload=await fetchDataset(city,dataset,{fetcher,timeoutMs,now});const saved=await cache.finish(city.id,dataset,row.lease,payload,60);if(saved){row={payload,fetched_at:new Date(now()).toISOString(),refresh_after:new Date(now()+(dataset==='weather'?900000:3600000)).toISOString()};}}
            catch(error){await cache.finish(city.id,dataset,row.lease,null,error.retryAfter||60);row={...row,retry_after:new Date(now()+60000).toISOString()};}
          }
          return presentCache(row,dataset,now());
        }catch{return {status:'unavailable'};}
      }
      const [weather,air_quality]=await Promise.all([load('weather'),load('air_quality')]);
      const recheck=await client.rpc('is_approved_operations');if(recheck.error||recheck.data!==true)return respond(403,{error:'Approved Operations access required.'});
      const rainfall_context=weather.status==='unavailable'?null:weather.rainfall_context;delete weather.rainfall_context;
      return respond(200,{version:VERSION,city,fetched_at:new Date(now()).toISOString(),weather,rainfall_context,air_quality,context_only:true});
    }catch{return respond(503,{error:'Environmental data unavailable.'});}
  };
}
