// Synthetic fixture values are NEVER sent to Supabase or mixed into production.
export const rows=[
  {id:'00000000-0000-4000-8000-000000000001',title:'Fixture water incident',category:'water',latitude:24.8607,longitude:67.0011,area:'Test center',status:'reported',priority:'critical'},
  {id:'00000000-0000-4000-8000-000000000002',title:'Fixture flood incident',category:'flood',latitude:24.88,longitude:67.04,area:'Test district',status:'acknowledged',priority:'high'},
  {id:'00000000-0000-4000-8000-000000000003',title:'Fixture resolved garbage',category:'garbage',latitude:24.85,longitude:67.08,area:'Test district',status:'resolved',priority:'normal'},
  {id:'00000000-0000-4000-8000-000000000004',title:'Fixture missing GPS',category:'other',latitude:null,longitude:null,area:'Not mapped',status:'reported',priority:'low'},
].map(row=>({...row,reporter_id:'fixture-user',description:'Local browser fixture for interaction testing. Not a real citizen report.',location_accuracy:12,reported_at:'2026-10-02T00:00:00Z',updated_at:'2026-10-02T00:00:00Z',submission_state:'submitted'}));
export const configurationError='';
export const supabase={
  from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null})})})}),
  storage:{from:()=>({createSignedUrl:async()=>({error:new Error('No real evidence in local fixture')})})},
  rpc:async(name,args)=>{
    if(name!=='nigraan_update_incident_status')return {error:new Error('Not implemented in fixture')};
    const incident=rows.find(row=>row.id===args.incident);
    if(!incident||incident.status!==args.expected_status)return {error:new Error('Fixture stale status')};
    incident.status=args.next_status;
    if(args.next_status==='assigned')incident.assigned_organization_id='fixture-organization';
    return {data:incident.id,error:null};
  },
};
export const requireSupabase=()=>supabase;
