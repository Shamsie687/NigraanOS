export async function invokeNigraanAi(client,input,signal) {
  const {data,error}=await client.functions.invoke('nigraan-ai',{body:input,signal});
  if(!error)return data;
  try{const body=await error.context?.json();if(body&&body.error&&Object.hasOwn(body,'snapshot'))return body;}catch{/* Never display raw provider errors. */}
  return {snapshot:null,answer:null,error:{code:'connection',message:'Nigraan AI is unavailable. Check the Edge Function setup or connection.'}};
}
export async function loadAiIncident(client,id) {
  const approval=await client.rpc('is_approved_operations');
  if(approval.error||approval.data!==true)throw new Error('Approved Operations access required.');
  const {data,error}=await client.from('incidents').select('id,title,description,category,latitude,longitude,location_accuracy,area,status,priority,assigned_organization_id,reported_at,updated_at,submission_state')
    .eq('id',id).eq('submission_state','submitted').single();
  if(error||!data)throw new Error('This incident is no longer available. Refresh your workspace.');
  return data;
}
