import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createTranscriptionHandler} from './handler.js';

const url=Deno.env.get('SUPABASE_URL')!;
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
// Built-in server-only Supabase key; never sent to browser or provider.
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createTranscriptionHandler({
  providerKey:()=>Deno.env.get('GROQ_API_KEY'),
  allowedOrigins:()=>Deno.env.get('TRANSCRIPTION_ALLOWED_ORIGINS')||'',
  userClient:(authorization:string)=>createClient(url,publicKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}}),
  admin,
}));
