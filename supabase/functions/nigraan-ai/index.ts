import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createAiHandler} from './handler.js';
const url=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_ANON_KEY')!;
Deno.serve(createAiHandler({
  providerKey:()=>Deno.env.get('GROQ_API_KEY'),
  model:()=>Deno.env.get('NIGRAAN_AI_MODEL')||'openai/gpt-oss-20b',
  allowedOrigins:()=>Deno.env.get('NIGRAAN_AI_ALLOWED_ORIGINS')||'',
  userClient:(authorization:string)=>createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}}),
}));
