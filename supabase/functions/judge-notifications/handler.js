import {sendGmail} from './gmail.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function emailMessage(job,{from,adminEmail='nigraanos.admin@gmail.com',site='https://nigraanos.netlify.app/'}) {
  const expiry=job.expires_at?new Date(job.expires_at).toISOString():null;
  if(!['requested','approved','rejected','revoked'].includes(job.event)||typeof job.recipient!=='string'||/[\r\n]/.test(job.recipient))throw new Error('Invalid event');
  if(job.event==='requested')return {from,to:[adminEmail],subject:'NigraanOS: judge access request',text:
    `A verified account requested temporary Operations access.\nRegistered email: ${job.recipient}\nRequested: ${new Date(job.requested_at).toISOString()} (UTC)\nSign in to review: ${site}#/judge-admin\nOpening this link grants no permissions.`};
  if(job.event==='approved'&&!expiry){
    const seconds=job.session_seconds??3600;
    if(![3600,43200].includes(seconds))throw new Error('Invalid session duration');
    const label=seconds===43200?'12-Hour':'60-Minute';
    const deadline=new Date(job.activation_expires_at).toISOString();
    return {from,to:[job.recipient],subject:'NigraanOS: Operations access approved',text:`Your Operations request is approved. Approval cycle ${job.cycle??1}.\nWebsite: ${site}\nSign in, open Operations access, and select Start My ${label} Access.\nActivate before ${deadline} (UTC). Your ${label.toLowerCase()} timer starts only when activation succeeds, not at approval or email opening. Delivery delays do not extend the activation deadline. Citizen access remains available. Email is advisory: check your access status on the website even if delivery is delayed.`};
  }
  // Preserve queued legacy approval text for already-started grants.
  if(job.event==='approved')return {from,to:[job.recipient],subject:'NigraanOS: Operations access approved',text:
    `Your temporary Operations access was approved.\nWebsite: ${site}\nExpires: ${expiry} (UTC).\nYour 60 minutes started when the administrator approved the request, not when you open this email. Delivery delays do not extend access. If access has already expired or been revoked, Citizen access remains available.`};
  return {from,to:[job.recipient],subject:`NigraanOS: Operations access ${job.event}`,text:
    job.event==='rejected'?`Thank you for requesting access. Your request was not approved. Contact the organizer if you need assistance. Citizen access remains available.\n${site}`:
      `Your temporary Operations access has been revoked by the organizer. Citizen access remains available.\n${site}`};
}
async function secretMatches(a,b){
  if(!a||!b||b.length<32)return false;
  const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [x,y]=await Promise.all([digest(a),digest(b)]);let result=0;for(let i=0;i<32;i++)result|=x[i]^y[i];return result===0;
}
export function createJudgeNotificationHandler({config,claim,finish,fetcher=fetch,log=(_value)=>{}}){
  return async request=>{
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    let job;
    try{
      if(request.method!=='POST')return reply(405,{error:'POST required'});
      const settings=config();
      if(!await secretMatches(request.headers.get('x-judge-webhook-secret'),settings.webhookSecret))return reply(403,{error:'Worker authorization required'});
      // Database webhooks may include full record snapshots. Only id/state is used.
      const reader=request.body?.getReader();if(!reader)return reply(400,{error:'Invalid webhook'});
      let raw='',count=0;const decoder=new TextDecoder();
      try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>16384)return reply(413,{error:'Webhook too large'});raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel();}
      const input=JSON.parse(raw);
      if(input.schema!=='public'||input.table!=='nigraan_judge_email_outbox'||!['INSERT','UPDATE'].includes(input.type)||!UUID.test(input.record?.id||''))return reply(400,{error:'Invalid webhook'});
      if(input.record.state!=='pending')return reply(200,{status:'ignored'});
      job=await claim(input.record.id);
      if(!job)return reply(200,{status:'already_claimed_or_complete'});
      const message=emailMessage(job,settings);
      const sentId=await sendGmail(message,job.id,settings,fetcher);
      await finish(job.id,job.lease,sentId,null);
      return reply(200,{status:'sent'});
    }catch(error){
      const code=['configuration','provider_failure','delivery_unknown'].includes(error?.safeCode)?error.safeCode:'delivery_unknown';
      if(job){try{await finish(job.id,job.lease,null,code);}catch{/* Lease remains recoverable through admin retry. */}}
      log({event:'judge_email_failure',code}); // No identities, bodies, keys or raw exceptions.
      return reply(503,{error:'Notification unavailable'});
    }
  };
}
