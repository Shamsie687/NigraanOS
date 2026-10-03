import {timestamp} from '../utils/operationsAnalytics.js';
export const analyticsActivityColumns='id,incident_id,kind,published_at';
export async function fetchAnalyticsActivity(client,{incidentIds,from=null,to,signal,pageSize=500,batchSize=200}){
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000||!Number.isInteger(batchSize)||batchSize<1||batchSize>200||!Number.isFinite(to)||from!==null&&(!Number.isFinite(from)||from>=to))throw new Error('Invalid activity request');
  const ids=[...new Set(incidentIds)],allowed=new Set(ids),rows=new Map();
  const cancel=()=>{if(signal?.aborted)throw new Error('Activity read cancelled');};
  for(let start=0;start<ids.length;start+=batchSize){
    // Advance by actual returned length and finish only on an empty page. A
    // configured PostgREST row cap must not silently turn a partial read into zero.
    for(let offset=0;;){
      cancel();let query=client.from('nigraan_citizen_changes').select(analyticsActivityColumns).eq('submission_state','published').in('incident_id',ids.slice(start,start+batchSize)).lt('published_at',new Date(to).toISOString());
      if(from!==null)query=query.gte('published_at',new Date(from).toISOString());
      query=query.order('published_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+pageSize-1);if(signal)query=query.abortSignal(signal);
      const {data,error}=await query;cancel();if(error)throw error;
      if(!Array.isArray(data))throw new Error('Activity metadata unavailable');
      for(const c of data){const t=timestamp(c.published_at);if(allowed.has(c.incident_id)&&['edit','update'].includes(c.kind)&&t!==null&&t<to&&(from===null||t>=from))rows.set(c.id,{id:c.id,incident_id:c.incident_id,kind:c.kind,published_at:c.published_at});}
      if(data.length===0)break;
      offset+=data.length;
    }
  }
  return [...rows.values()];
}
