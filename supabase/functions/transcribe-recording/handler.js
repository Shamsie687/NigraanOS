// Dependency-injected real HTTP handler; Node tests exercise this without keys.
// No transcripts, raw audio, tokens or provider responses are logged.
const MAX_AUDIO=10*1024*1024;
const MAX_BODY=MAX_AUDIO+64*1024;
const TYPES={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class HttpError extends Error {constructor(status,message,code=null,retryAfter=null){super(message);this.status=status;this.code=code;this.retryAfter=retryAfter;}}
async function boundedBytes(stream,limit) {
  if (!stream) throw new HttpError(400,'Audio is required.');
  const reader=stream.getReader();let size=0;const chunks=[];
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit){await reader.cancel();throw new HttpError(413,'Recording exceeds 10 MB.');} chunks.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export function validateAudio(bytes,mime) {
  if(!TYPES[mime]||!bytes.length||bytes.length>MAX_AUDIO)throw new HttpError(400,'Use a non-empty WebM, Ogg or MP4 recording up to 10 MB.');
  const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
  const webm=[0x1a,0x45,0xdf,0xa3].every((value,index)=>bytes[index]===value);
  if(!(mime==='audio/webm'&&webm || mime==='audio/ogg'&&ascii(0,4)==='OggS' || mime==='audio/mp4'&&ascii(4,8)==='ftyp')) {
    throw new HttpError(400,'Recording contents do not match the supported audio type.');
  }
}
async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function createTranscriptionHandler({providerKey,allowedOrigins,userClient,admin,fetcher=fetch}) {
  return async function handler(request) {
    const origin=request.headers.get('Origin');
    const allowed=allowedOrigins().split(',').map(value=>value.trim()).filter(Boolean);
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
    if(origin&&allowed.includes(origin)) Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
    const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers});
    let jobId=null;
    try {
      if(origin&&!allowed.includes(origin))throw new HttpError(403,'This application origin is not configured for transcription.');
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(request.method!=='POST')throw new HttpError(405,'Use POST.');
      const authorization=request.headers.get('Authorization')||'';
      if(!/^Bearer \S+$/.test(authorization))throw new HttpError(401,'Sign in before transcribing.');
      const client=userClient(authorization);
      const identity=await client.auth.getUser();
      const user=identity.data?.user;
      if(identity.error||!user)throw new HttpError(401,'Session expired. Sign in again.');
      const profile=await client.from('profiles').select('id,account_type').eq('id',user.id).maybeSingle();
      if(profile.error||!profile.data)throw new HttpError(403,'Citizen account required.');
      const type=request.headers.get('Content-Type')||'';
      // Bind a completed receipt to actual private uploaded bytes, not client MIME
      // or a browser-supplied hash. RLS checks the caller owns a writable draft.
      if(type.startsWith('application/json')) {
        const bytes=await boundedBytes(request.body,4096);
        let input;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Invalid binding request.');}
        const {action,jobId:receiptId,storagePath}=input;
        if(action!=='bind'||!UUID.test(receiptId||'')||typeof storagePath!=='string'||storagePath.length>240)throw new HttpError(400,'Invalid transcript receipt.');
        const parts=storagePath.split('/');
        if(![3,4].includes(parts.length)||parts[0]!==user.id||!UUID.test(parts[1])||parts.length===4&&!UUID.test(parts[2])||!/^[0-9a-f-]{36}\.(webm|ogg|m4a)$/i.test(parts.at(-1)))throw new HttpError(403,'Invalid audio ownership.');
        if(parts.length===3) {
          const draft=await client.from('incidents').select('id,reporter_id,submission_state').eq('id',parts[1]).maybeSingle();
          if(draft.error||draft.data?.reporter_id!==user.id||draft.data?.submission_state!=='draft')throw new HttpError(403,'A self-owned draft is required.');
        } else {
          // Additive report edits/updates use a private change draft, not a new
          // incident. Read through caller RLS; ownership and hash checks remain.
          const change=await client.from('nigraan_citizen_changes').select('id,incident_id,citizen_id,submission_state').eq('id',parts[2]).maybeSingle();
          if(change.error||change.data?.citizen_id!==user.id||change.data?.incident_id!==parts[1]||change.data?.submission_state!=='draft')throw new HttpError(403,'A self-owned draft is required.');
        }
        const job=await admin.from('nigraan_transcription_jobs').select('*').eq('id',receiptId).eq('user_id',user.id).maybeSingle();
        if(job.error||!job.data||job.data.status!=='ready'||job.data.consumed_incident||Date.parse(job.data.expires_at)<=Date.now())throw new HttpError(400,'Transcript receipt expired or unavailable. Keep audio without transcript and retry.');
        const object=await client.storage.from('incident-evidence').download(storagePath);
        if(object.error||!object.data||object.data.size>MAX_AUDIO)throw new HttpError(400,'Private recording could not be checked.');
        const hash=await digest(await boundedBytes(object.data.stream(),MAX_AUDIO));
        if(hash!==job.data.audio_sha256)throw new HttpError(400,'Transcript does not match this recording. Re-transcribe or keep audio only.');
        const bound=await admin.from('nigraan_transcription_jobs').update({bound_path:storagePath}).eq('id',receiptId).eq('user_id',user.id).is('consumed_incident',null).select('id');
        if(bound.error||bound.data?.length!==1)throw new HttpError(503,'Transcript could not be attached. Retry submission or keep audio only.');
        return respond(200,{bound:true});
      }
      if(!type.startsWith('multipart/form-data'))throw new HttpError(415,'Multipart audio is required.');
      if(!providerKey())throw new HttpError(503,'Transcription is not configured. Your administrator must set GROQ_API_KEY. Keep audio or retry later.');
      const bytes=await boundedBytes(request.body,MAX_BODY);
      let form;try{form=await new Request('https://local.invalid',{method:'POST',headers:{'Content-Type':type},body:bytes}).formData();}catch{throw new HttpError(400,'Invalid audio upload.');}
      const file=form.get('audio');const language=form.get('language')||'auto';
      if(!file||typeof file==='string'||!['auto','ur','en'].includes(language))throw new HttpError(400,'Choose a recording and automatic, Urdu or English.');
      const mime=file.type.split(';')[0];const audio=new Uint8Array(await file.arrayBuffer());validateAudio(audio,mime);
      const started=await admin.rpc('nigraan_start_transcription',{caller:user.id,audio_hash:await digest(audio),language_choice:language});
      if(started.error) {
        let detail={};try{detail=JSON.parse(started.error.details||'{}');}catch{/* Only structured, allowlisted quota failures are classified. */}
        const retry=Number.isFinite(detail.retry_after)?Math.max(1,Math.ceil(detail.retry_after)):null;
        if(started.error.code==='PT409'&&detail.code==='transcription_busy')throw new HttpError(409,'Another recording is already being transcribed. Wait for it to finish, or keep audio without a transcript.','transcription_busy',retry);
        if(started.error.code==='PT429'&&['app_quota_short','app_quota_daily'].includes(detail.code))throw new HttpError(429,detail.code==='app_quota_daily'?'Your daily transcription allowance is used. Keep audio or try again later.':'You have made several transcription attempts recently. Keep audio or try again shortly.',detail.code,retry);
        throw new HttpError(503,'Transcription storage is unavailable. Ask your administrator to check the transcription setup.');
      }
      jobId=started.data;
      const upload=new FormData();upload.append('file',new Blob([audio],{type:mime}),'recording.'+TYPES[mime]);
      upload.append('model','whisper-large-v3');upload.append('response_format','verbose_json');upload.append('temperature','0');
      if(language!=='auto')upload.append('language',language);
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
      let result;
      try {
        const provider=await fetcher('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+providerKey()},body:upload,signal:controller.signal});
        if(!provider.ok) {
          const rawRetry=provider.headers.get('retry-after');
          const providerRetry=rawRetry&&/^\d+$/.test(rawRetry)?Number(rawRetry):null;
          throw new HttpError(provider.status===429?429:502,provider.status===429?'The speech service is busy. Keep audio or try again later.':'Speech service failed. Your recording is retained; retry or keep audio only.',provider.status===429?'provider_rate_limited':null,provider.status===429?providerRetry:null);
        }
        try{result=JSON.parse(new TextDecoder().decode(await boundedBytes(provider.body,256*1024)));}catch{throw new HttpError(502,'Speech service returned an unusable response.');}
      } finally{clearTimeout(timeout);}
      if(typeof result.text!=='string'||!result.text.trim()||result.text.length>12000)throw new HttpError(422,'No usable speech transcript was returned. Keep audio or re-record.');
      if(!Number.isFinite(result.duration)||result.duration<=0||result.duration>125)throw new HttpError(422,'Recording must be no longer than two minutes. Re-record or keep audio only.');
      const detectedLanguage=typeof result.language==='string'?result.language.slice(0,80):null;
      const saved=await admin.from('nigraan_transcription_jobs').update({status:'ready',machine_text:result.text,detected_language:detectedLanguage,completed_at:new Date().toISOString(),active_until:null}).eq('id',jobId).eq('status','pending').gt('active_until',new Date().toISOString()).select('id');
      if(saved.error||saved.data?.length!==1)throw new HttpError(503,'Transcript could not be saved. Retry or keep audio only.');
      return respond(200,{jobId,text:result.text,detectedLanguage,selectedLanguage:language});
    } catch(error) {
      if(jobId){try{await admin.from('nigraan_transcription_jobs').update({status:'failed',completed_at:new Date().toISOString(),active_until:null}).eq('id',jobId).eq('status','pending');}catch{/* A crashed/failed cleanup lease expires naturally. */}}
      if(error instanceof HttpError&&error.retryAfter)headers['Retry-After']=String(error.retryAfter);
      return respond(error instanceof HttpError?error.status:503,{error:error instanceof HttpError?error.message:'Transcription could not complete. Your recording is retained; retry or keep audio only.',...(error instanceof HttpError&&error.code?{code:error.code}:{}),...(error instanceof HttpError&&error.retryAfter?{retryAfter:error.retryAfter}:{})});
    }
  };
}
