// Browser-safe client injection: all reads remain subject to Supabase RLS.
// No evidence/signature URLs are requested for map markers.
export const mapIncidentColumns='id,reporter_id,title,description,category,latitude,longitude,location_accuracy,area,status,priority,assigned_organization_id,reported_at,updated_at,submission_state';
export async function fetchMapIncidents(client,{signal,pageSize=500}={}) {
  if (!Number.isInteger(pageSize)||pageSize<1||pageSize>1000) throw new Error('Invalid incident page size.');
  const rows=new Map();
  let offset=0;
  while (true) {
    if (signal?.aborted) throw new Error('Incident refresh cancelled.');
    let query=client.from('incidents').select(mapIncidentColumns)
      .eq('submission_state','submitted')
      .order('reported_at',{ascending:false}).order('id',{ascending:false})
      .range(offset,offset+pageSize-1);
    if (signal) query=query.abortSignal(signal);
    const {data,error}=await query;
    if (error) throw error;
    for (const incident of data) rows.set(incident.id,incident);
    if (data.length<pageSize) break;
    offset+=data.length;
  }
  return [...rows.values()];
}
// Notifications invalidate the authenticated query rather than merging raw event
// payloads. This also catches draft -> submitted UPDATE after evidence finalization.
export function observeIncidentChanges(client,onChange,onState,{schedule=setTimeout,cancel=clearTimeout,delay=250}={}) {
  let active=true,timer=null,channel;
  const changed=()=>{
    if (!active) return;
    onState('receiving');
    if (timer!==null) cancel(timer);
    timer=schedule(()=>{timer=null;if(active)onChange();},delay);
  };
  try {
    channel=client.channel('operations-incidents-'+crypto.randomUUID());
    for(const event of ['INSERT','UPDATE'])channel.on('postgres_changes',{
      event,schema:'public',table:'incidents',filter:'submission_state=eq.submitted',
    },changed);
    channel.subscribe(status=>{
      if (!active) return;
      if (status==='SUBSCRIBED') {onState('connected');onChange();}
      else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) onState('fallback');
    });
  } catch {onState('fallback');}
  return ()=>{
    active=false;
    if(timer!==null)cancel(timer);
    if(channel){try{Promise.resolve(client.removeChannel(channel)).catch(()=>{});}catch{}}
  };
}
