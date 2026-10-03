import {FACT_REFS,RESPONSE_LIMITS} from './context.js';
const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys)=>plainObject(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export class ValidationDiagnostic extends Error {
  constructor(code,field,message){super(message);this.code=code;this.field=field;}
}
const fail=(code,field,message)=>{throw new ValidationDiagnostic(code,field,message);};
function shapeFailure(value,keys,path,message){
  if(!plainObject(value))fail('validation_invalid_type',path,message);
  for(const key of keys)if(!Object.hasOwn(value,key))fail('validation_missing_field',path==='response'?key:path+'.'+key,message);
  // Never expose arbitrary provider-controlled property names.
  fail('validation_extra_field',path,message);
}
function safeProse(text,maximum,path) {
  if(typeof text!=='string')fail('validation_invalid_type',path,'Invalid prose');
  if([...text].length>maximum)fail('validation_text_too_long',path,'Invalid prose');
  // Facts belong in server-rendered cards. Reject numeric claims, URLs, raw IDs
  // and common unsupported action assertions instead of presenting them as AI.
  if(/\p{N}|[%٪]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|twice|percent)\b/iu.test(text))fail('validation_numeric_claim',path,'Unsupported factual claim');
  if(/https?:|www\./i.test(text))fail('validation_forbidden_url',path,'Unsupported factual claim');
  // Exempt only this complete negative sentence, never a whole response or clause.
  const actionProse=text.replace(/(^|[.!?]\s+)No department has been dispatched\.(?=\s|$)/gi,'$1');
  if(/\b(?:dispatched|confirmed emergency|has been resolved|have been resolved|everything is resolved|(?:is|was|were|has been) verified)\b/i.test(actionProse))fail('validation_forbidden_action_claim',path,'Unsupported factual claim');
  if(/\b(?:all|every|these|the)\s+(?:\w+\s+)?(?:incidents|reports)\s+(?:are|is|were|have been)\s+(?:resolved|assigned|acknowledged|verified|critical)\b/i.test(text))fail('validation_forbidden_state_claim',path,'Unsupported state assertion');
}
function validateStructure(value,aliases) {
  if(!exactKeys(value,['fact_refs','interpretation','suggestions','limitations']))shapeFailure(value,['fact_refs','interpretation','suggestions','limitations'],'response','Invalid response schema');
  if(!Array.isArray(value.fact_refs))fail('validation_invalid_fact_refs','fact_refs','Invalid fact reference');
  if(value.fact_refs.length>RESPONSE_LIMITS.facts)fail('validation_too_many_fact_refs','fact_refs','Invalid fact reference');
  if(value.fact_refs.some(ref=>!FACT_REFS.includes(ref)))fail('validation_invalid_fact_refs','fact_refs','Invalid fact reference');
  for(const key of ['interpretation','suggestions']) {
    if(!Array.isArray(value[key]))fail('validation_invalid_type',key,'Invalid sections');
    if(value[key].length>RESPONSE_LIMITS.bullets)fail('validation_too_many_bullets',key,'Invalid sections');
    for(const [index,bullet] of value[key].entries()) {
      const path=key+'['+index+']';
      if(!exactKeys(bullet,['text','refs']))shapeFailure(bullet,['text','refs'],path,'Unsupported citation');
      if(!Array.isArray(bullet.refs)||bullet.refs.length>RESPONSE_LIMITS.refs)fail('validation_invalid_refs',path+'.refs','Unsupported citation');
      if(bullet.refs.some(ref=>typeof ref!=='string'||!Object.hasOwn(aliases,ref)))fail('validation_unknown_alias',path+'.refs','Unsupported citation');
      if(typeof bullet.text!=='string')fail('validation_invalid_type',path+'.text','Invalid prose');
      if(!bullet.refs.length&&Object.keys(aliases).length)fail('validation_empty_refs',path+'.refs','Interpretation requires a citation');
    }
  }
  if(typeof value.limitations!=='string')fail('validation_invalid_type','limitations','Invalid prose');
}
export function validateResponse(value,aliases) {
  validateStructure(value,aliases);
  for(const key of ['interpretation','suggestions'])for(const [index,bullet] of value[key].entries())safeProse(bullet.text,RESPONSE_LIMITS.text,key+'['+index+'].text');
  safeProse(value.limitations,RESPONSE_LIMITS.text,'limitations');
  return value;
}
const CONTENT_REASONS={validation_numeric_claim:'numeric_claim',validation_forbidden_action_claim:'unsupported_action_claim',validation_forbidden_state_claim:'unsupported_action_claim',validation_text_too_long:'text_too_long',validation_forbidden_url:'forbidden_url'};
export function validateBriefing(value,aliases){
  // Preflight ALL refs and shapes before dropping anything: security errors are fatal.
  validateStructure(value,aliases);
  const answer={fact_refs:[...value.fact_refs],interpretation:[],suggestions:[],limitations:''};
  const metadata={status:'complete',dropped_interpretation_count:0,dropped_suggestion_count:0,reason_codes:[],dropped_limitations:false};
  function accepted(text,path){
    try{safeProse(text,RESPONSE_LIMITS.text,path);return true;}
    catch(error){if(!(error instanceof ValidationDiagnostic)||!Object.hasOwn(CONTENT_REASONS,error.code))throw error;
      metadata.status='partial';const reason=CONTENT_REASONS[error.code];if(!metadata.reason_codes.includes(reason))metadata.reason_codes.push(reason);return false;}
  }
  for(const key of ['interpretation','suggestions'])for(const [index,bullet] of value[key].entries()){
    if(accepted(bullet.text,key+'['+index+'].text'))answer[key].push({text:bullet.text,refs:[...bullet.refs]});
    else metadata[key==='interpretation'?'dropped_interpretation_count':'dropped_suggestion_count']++;
  }
  if(accepted(value.limitations,'limitations'))answer.limitations=value.limitations;else metadata.dropped_limitations=true;
  return {answer,answer_validation:metadata,received:{interpretation:value.interpretation.length,suggestions:value.suggestions.length}};
}
