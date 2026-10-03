import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createCityContextHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')!;
// Privileged client is confined to two environmental RPCs, never incident reads.
const environmentalClient=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await environmentalClient.rpc(name,args);if(error)throw new Error('Cache unavailable');return data;}
Deno.serve(createCityContextHandler({
  allowedOrigins:()=>Deno.env.get('CITY_CONTEXT_ALLOWED_ORIGINS')||'http://127.0.0.1:5173,http://localhost:5173',
  userClient:(authorization:string)=>createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}}),
  cache:{claim:(city:string,dataset:string)=>rpc('city_environment_claim',{city_choice:city,dataset_choice:dataset}),finish:(city:string,dataset:string,token:string,payload:unknown,retry:number)=>rpc('city_environment_finish',{city_choice:city,dataset_choice:dataset,token_choice:token,result_choice:payload,retry_seconds:retry})},
}));
