import {requireSupabase} from './supabase';
export {remainingAccessMs} from '../utils/judgeAccess';
export async function loadOperationsAccess(client=requireSupabase()) {
  const started=performance.now();
  const {data,error}=await client.rpc('nigraan_operations_access_context').abortSignal(AbortSignal.timeout(5000));
  if(error)throw new Error('Unable to verify current Operations access.');
  if(!data||typeof data.allowed!=='boolean'||typeof data.permanent!=='boolean'||!Number.isFinite(Date.parse(data.server_now)))throw new Error('Invalid access response.');
  const seconds=data.session_seconds??3600;
  if(data.allowed&&!data.permanent&&(![3600,43200].includes(seconds)||!Number.isFinite(Date.parse(data.expires_at))||data.status!=='active'||!Number.isFinite(Date.parse(data.started_at))||Date.parse(data.expires_at)-Date.parse(data.started_at)!==seconds*1000))throw new Error('Invalid temporary access response.');
  // Conservatively subtract full request latency; a delayed response cannot extend the timer.
  return {...data,receivedAt:started};
}
export async function judgeRpc(name,args={}) {
  const {data,error}=await requireSupabase().rpc(name,args);
  if(error)throw new Error(error.message||'Judge access action failed.');
  return data;
}
