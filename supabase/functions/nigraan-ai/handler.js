import {validateInput,buildGrounding} from './context.js';
import {validateBriefing,ValidationDiagnostic} from './responseValidation.js';
class AiError extends Error {constructor(status,code,message,retryAfter=null){super(message);Object.assign(this,{status,code,retryAfter});}}
const MESSAGES={ai_busy:'An AI request is active or cooling down.',app_quota_short:'Your short AI request limit has been reached.',app_quota_daily:'Your daily AI request limit has been reached.',shared_quota_short:'AI is briefly busy. Please retry shortly.',shared_quota_daily:'Today’s shared AI request budget has been reached.',provider_rate_limited:'The AI provider is busy. Please retry later.',timeout:'AI request timed out.',malformed_response:'AI returned an unusable briefing.',configuration:'AI service is not configured.',context_budget:'This question exceeds the briefing context budget.',provider_unavailable:'AI provider is unavailable.'};
async function boundedJson(response,limit,signal,metrics=null) {
  const reader=response.body?.getReader();if(!reader)throw new Error('Missing body');
  const parts=[];let length=0;
  try{while(true){if(signal?.aborted)throw new DOMException('Aborted','AbortError');const {value,done}=await reader.read();if(done)break;length+=value.length;if(metrics)metrics.response_bytes=length;if(length>limit)throw new Error('Body too large');parts.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const decoded=new TextDecoder().decode(bytes);if(metrics)metrics.response_characters=decoded.length;
  return JSON.parse(decoded);
}
const safeRequestId=value=>typeof value==='string'&&/^req_[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value)?value:null;
const safeAliases=values=>Array.isArray(values)?[...new Set(values.filter(value=>typeof value==='string'&&/^[IU][0-9]{1,4}$/.test(value)))].slice(0,64):[];
function returnedAliases(value){
  const refs=[];for(const key of ['interpretation','suggestions'])if(Array.isArray(value?.[key]))for(const bullet of value[key].slice(0,16))if(Array.isArray(bullet?.refs))refs.push(...bullet.refs.slice(0,16));
  return safeAliases(refs);
}
function referenceFormats(value){
  const counts={canonical:0,bracketed:0,combined:0,empty:0,other_string:0,non_string:0};
  for(const key of ['interpretation','suggestions'])if(Array.isArray(value?.[key]))for(const bullet of value[key].slice(0,16))if(Array.isArray(bullet?.refs))for(const ref of bullet.refs.slice(0,16)){
    const kind=typeof ref!=='string'?'non_string':/^[IU][0-9]{1,4}$/.test(ref)?'canonical':/^\[[IU][0-9]{1,4}\]$/.test(ref)?'bracketed':/^[IU][0-9]{1,4}(?:\s*,\s*[IU][0-9]{1,4})+$/.test(ref)?'combined':!ref.trim()?'empty':'other_string';
    counts[kind]++;
  }
  return counts;
}
export function createAiHandler({userClient,providerKey,allowedOrigins,model=()=> 'openai/gpt-oss-20b',fetcher=fetch,timeoutMs=30000,totalTimeoutMs=45000,diagnosticLogger=record=>console.warn(JSON.stringify(record))}) {
  return async request=>{
    const origin=request.headers.get('Origin');
    const allowed=allowedOrigins().split(',').map(s=>s.trim()).filter(Boolean);
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin&&allowed.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Retry-After'});
    const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    let facts=null;let timer,providerTimer;const controller=new AbortController();
    try {
      if(origin&&!allowed.includes(origin))throw new AiError(403,'origin','This application origin is not configured for AI.');
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(request.method!=='POST')throw new AiError(405,'method','Use POST.');
      const authorization=request.headers.get('Authorization')||'';
      if(!/^Bearer \S+$/i.test(authorization))throw new AiError(401,'auth','Sign in to use Nigraan AI.');
      timer=setTimeout(()=>controller.abort(),totalTimeoutMs);
      const client=userClient(authorization);
      const identity=await client.auth.getUser();
      if(identity.error||!identity.data?.user)throw new AiError(401,'auth','Sign in again to use Nigraan AI.');
      const approval=await client.rpc('is_approved_operations').abortSignal(controller.signal);
      if(approval.error||approval.data!==true)throw new AiError(403,'access','Approved Operations access required.');
      let input;try{input=validateInput(await boundedJson(request,4096,controller.signal));}catch{throw new AiError(400,'input','Enter a supported question and scope (up to 600 characters).');}
      const snapshot=await client.rpc('nigraan_ai_snapshot',{scope_choice:input.scope,category_choice:input.category,activity_hours:input.activityHours,selected_incident:input.incidentId}).abortSignal(controller.signal);
      if(snapshot.error)throw new AiError(snapshot.error.code==='PT403'?403:snapshot.error.code==='PT404'?404:503,snapshot.error.code==='PT403'?'access':'database','Authorized incident facts are unavailable. Check migration 009 and your access.');
      facts={...snapshot.data,
        incidents:snapshot.data.incidents.map((row,index)=>({...row,alias:'I'+(index+1)})),
        activity:snapshot.data.activity.map((row,index)=>({...row,alias:'U'+(index+1)}))};
      if(!providerKey()||model()!=='openai/gpt-oss-20b')throw new AiError(503,'configuration',MESSAGES.configuration);
      let grounding;try{grounding=buildGrounding(facts,input,model());}catch{throw new AiError(413,'context_budget',MESSAGES.context_budget);}
      facts=grounding.snapshot;
      const admission=await client.rpc('nigraan_ai_admit').abortSignal(controller.signal);
      if(admission.error){let detail={};try{detail=JSON.parse(admission.error.details);}catch{}
        const code=Object.hasOwn(MESSAGES,detail.code)?detail.code:admission.error.code==='PT403'?'access':'database';
        throw new AiError(admission.error.code==='PT429'?429:admission.error.code==='PT409'?409:admission.error.code==='PT403'?403:503,code,MESSAGES[code]||'AI admission unavailable.',detail.retryAfter);}
      if(controller.signal.aborted)throw new AiError(504,'timeout',MESSAGES.timeout);
      providerTimer=setTimeout(()=>controller.abort(),timeoutMs);
      const provider=await fetcher('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+providerKey(),'Content-Type':'application/json'},body:JSON.stringify(grounding.payload),signal:controller.signal});
      if(!provider.ok){await provider.body?.cancel();throw new AiError(provider.status===429?429:502,provider.status===429?'provider_rate_limited':'provider_unavailable',provider.status===429?MESSAGES.provider_rate_limited:MESSAGES.provider_unavailable,provider.status===429?Math.min(86400,Math.max(1,Number(provider.headers.get('retry-after'))||60)):null);}
      const diagnostic={event:'nigraan_ai_malformed_response',stage:'provider_envelope_parse_failed',provider_http_status:provider.status,
        provider_request_id:safeRequestId(provider.headers.get('x-request-id')),finish_reason:null,
        provider_envelope_parsed:false,completion_json_parsed:false,response_bytes:0,response_characters:null,
        completion_content_length:null,validation_code:null,validation_field_path:null,
        supplied_aliases:safeAliases(Object.keys(grounding.aliases)),returned_aliases:[]};
      let answer,validation;
      try{
        const result=await boundedJson(provider,32768,controller.signal,diagnostic);
        diagnostic.provider_envelope_parsed=true;
        diagnostic.provider_request_id=diagnostic.provider_request_id||safeRequestId(result?.x_groq?.id);
        const choice=result?.choices?.[0];
        diagnostic.finish_reason=['stop','length','tool_calls','function_call','content_filter'].includes(choice?.finish_reason)?choice.finish_reason:null;
        const content=choice?.message?.content;
        diagnostic.completion_content_length=typeof content==='string'?content.length:null;
        if(choice?.finish_reason==='length'){diagnostic.stage='completion_truncated';throw new Error('Incomplete response');}
        if(typeof content!=='string'||!content.trim()){diagnostic.stage='completion_missing';throw new Error('Missing completion');}
        diagnostic.stage='completion_json_parse_failed';
        const value=JSON.parse(content);diagnostic.completion_json_parsed=true;
        diagnostic.returned_aliases=returnedAliases(value);
        diagnostic.reference_format_counts=referenceFormats(value);
        diagnostic.stage='schema_or_application_validation_failed';
        validation=validateBriefing(value,grounding.aliases);answer=validation.answer;
      }catch(error){
        if(controller.signal.aborted)throw error;
        if(error instanceof ValidationDiagnostic){diagnostic.validation_code=error.code;diagnostic.validation_field_path=error.field;}
        else if(diagnostic.stage==='schema_or_application_validation_failed')diagnostic.validation_code='validation_unclassified';
        // Explicit metadata only; no errors/stacks, raw bodies, prose or mappings.
        try{diagnosticLogger(diagnostic);}catch{/* Logging failure must not affect the response. */}
        throw new AiError(502,'malformed_response',MESSAGES.malformed_response);
      }
      clearTimeout(providerTimer);
      // Recheck approval and current RLS for every cited supporting incident.
      const reapproval=await client.rpc('is_approved_operations').abortSignal(controller.signal);
      if(reapproval.error||reapproval.data!==true)throw new AiError(403,'access','Operations access changed.');
      const ids=facts.incidents.map(i=>i.id);
      if(ids.length){const current=await client.from('incidents').select('id').eq('submission_state','submitted').in('id',ids).abortSignal(controller.signal);
        if(current.error||current.data.length!==ids.length)throw new AiError(403,'access','Incident access changed. Refresh your workspace.');}
      if(controller.signal.aborted)throw new AiError(504,'timeout',MESSAGES.timeout);
      if(validation.answer_validation.status==='partial'){
        const aggregate={event:'nigraan_ai_partial_response',interpretation_received:validation.received.interpretation,interpretation_retained:answer.interpretation.length,interpretation_dropped:validation.answer_validation.dropped_interpretation_count,suggestions_received:validation.received.suggestions,suggestions_retained:answer.suggestions.length,suggestions_dropped:validation.answer_validation.dropped_suggestion_count,reason_codes:validation.answer_validation.reason_codes,supplied_aliases:safeAliases(Object.keys(grounding.aliases)),retained_aliases:returnedAliases(answer)};
        try{diagnosticLogger(aggregate);}catch{/* Logging must not change the answer. */}
      }
      return respond(200,{snapshot:facts,answer,answer_validation:validation.answer_validation,error:null});
    } catch(error) {
      let cause=error instanceof AiError?error:new AiError(controller.signal.aborted?504:502,controller.signal.aborted?'timeout':'provider_unavailable',controller.signal.aborted?MESSAGES.timeout:MESSAGES.provider_unavailable);
      // On failures as well, never return collected facts after approval revocation.
      if(facts&&cause.code!=='access'){
        const accessController=new AbortController();const accessTimer=setTimeout(()=>accessController.abort(),3000);
        try{const client=userClient(request.headers.get('Authorization'));const check=await client.rpc('is_approved_operations').abortSignal(accessController.signal);
          if(check.error||check.data!==true)throw new Error('Access changed');
          const ids=facts.incidents.map(i=>i.id);
          if(ids.length){const current=await client.from('incidents').select('id').eq('submission_state','submitted').in('id',ids).abortSignal(accessController.signal);if(current.error||current.data.length!==ids.length)throw new Error('Access changed');}
        }catch{cause=new AiError(403,'access','Unable to confirm current Operations access.');}
        finally{clearTimeout(accessTimer);}
      }
      if(['auth','access','origin'].includes(cause.code))facts=null;
      if(Number.isFinite(cause.retryAfter)&&cause.retryAfter>0)headers['Retry-After']=String(cause.retryAfter);
      return respond(cause.status,{snapshot:facts,answer:null,error:{code:cause.code,message:cause.message,retryAfter:cause.retryAfter}});
    } finally {clearTimeout(timer);clearTimeout(providerTimer);controller.abort();}
  };
}
