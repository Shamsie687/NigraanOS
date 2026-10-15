import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createJudgeEvidenceHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')!;
// Privileged download ONLY targets an exact caller-RLS-authorized evidence path.
Deno.serve(createJudgeEvidenceHandler({
  allowedOrigins:()=>Deno.env.get('JUDGE_ALLOWED_ORIGINS')||'',
  userClient:(authorization:string)=>createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}}),
  download:async(path:string,size:number)=>{
    const response=await fetch(url+'/storage/v1/object/incident-evidence/'+path.split('/').map(encodeURIComponent).join('/'),{
      headers:{Authorization:'Bearer '+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,apikey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!},signal:AbortSignal.timeout(10000)});
    if(!response.ok||Number(response.headers.get('Content-Length'))>size)throw new Error('Unavailable');
    const reader=response.body!.getReader(),parts:Uint8Array[]=[];let count=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;count+=value.length;if(count>size)throw new Error('Too large');parts.push(value);}}finally{await reader.cancel();}
    const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
  }
}));
