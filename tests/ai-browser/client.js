// TEST ONLY. Every provider response in this file is an automated UI fixture.
export const incident={id:'00000000-0000-4000-8000-000000000001',title:'TEST ONLY · Drain blockage near public road',description:'Isolated automated fixture, not a real incident.',category:'water',status:'reported',priority:'normal',latitude:24.8,longitude:67,reported_at:'2026-09-28T00:00:00Z',updated_at:'2026-10-02T00:00:00Z',submission_state:'submitted'};
export const testState={mode:'success',requests:0,detailReads:0,aborted:0};
const snapshot=()=>({snapshotAt:new Date().toISOString(),scope:{mode:'briefing',category:'all',activityHours:24},facts:{matchingCount:1,unresolvedCount:1,oldestUnresolvedSeconds:345600,recentUpdateCount:1,recentEditCount:0,categories:{water:1},statuses:{reported:1}},incidents:[{...incident,alias:'I1',age_seconds:345600}],activity:[],includedCount:1,omittedCount:0,includedActivityCount:0,omittedActivityCount:1});
const client={rpc:async(name)=>name==='is_approved_operations'?{data:true}:{data:null},functions:{invoke:async(name,{body,signal})=>{
  if(name!=='nigraan-ai')throw new Error('Unexpected function');testState.requests++;
  if(testState.mode==='slow'){await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,10000);signal.addEventListener('abort',()=>{clearTimeout(timer);testState.aborted++;reject(new DOMException('aborted','AbortError'));},{once:true});});}
  const s=snapshot();s.scope={mode:body.scope,category:body.category,activityHours:body.activityHours};
  return {data:{snapshot:s,answer:testState.mode==='failure'?null:{fact_refs:['matchingCount'],interpretation:[{text:'TEST ONLY: human review is appropriate.',refs:['I1']}],suggestions:[{text:'TEST ONLY: inspect the supporting report.',refs:['I1']}],limitations:'Automated UI fixture only.'},error:testState.mode==='failure'?{code:'provider_rate_limited',message:'TEST ONLY: provider busy.',retryAfter:60}:null}};
}},from:table=>{
  const query={select:()=>query,eq:()=>query,order:()=>Promise.resolve({data:[]}),range:()=>Promise.resolve({data:[]}),single:async()=>{testState.detailReads++;return {data:incident};}};
  if(table==='nigraan_citizen_changes')query.order=()=>query;
  return query;
}};
export const configurationError=null;export const supabase=client;export const requireSupabase=()=>client;
