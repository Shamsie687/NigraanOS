export async function loadCommandActivity(client,incidentIds,signal){
  const rows=[];
  // Explicit authorized parent set + existing RLS; no bodies/evidence are fetched.
  for(let offset=0;offset<incidentIds.length;offset+=200){
    let query=client.from('nigraan_citizen_changes').select('id,incident_id,kind,published_at').eq('submission_state','published').in('incident_id',incidentIds.slice(offset,offset+200)).order('published_at',{ascending:false}).order('id',{ascending:false}).limit(5);
    if(signal)query=query.abortSignal(signal);const {data,error}=await query;if(error)throw error;rows.push(...data);
  }
  return rows;
}
