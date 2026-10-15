import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createJudgeNotificationHandler} from './handler.js';
// This worker's service-role usage is confined to outbox claim/finish RPCs.
const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await client.rpc(name,args);if(error)throw new Error('Queue unavailable');return data;}
Deno.serve(createJudgeNotificationHandler({
  config:()=>({webhookSecret:Deno.env.get('JUDGE_WEBHOOK_SECRET'),clientId:Deno.env.get('GMAIL_CLIENT_ID'),clientSecret:Deno.env.get('GMAIL_CLIENT_SECRET'),refreshToken:Deno.env.get('GMAIL_REFRESH_TOKEN'),from:Deno.env.get('JUDGE_EMAIL_FROM'),adminEmail:'nigraanos.admin@gmail.com',site:'https://nigraanos.netlify.app/'}),
  claim:(id:string)=>rpc('nigraan_claim_judge_email',{job_id:id}),
  finish:(id:string,lease:string,sentId:string|null,errorCode:string|null)=>rpc('nigraan_finish_judge_email',{job_id:id,lease_id:lease,sent_id:sentId,error_code:errorCode}),
  log:(value:unknown)=>console.warn(JSON.stringify(value))
}));
