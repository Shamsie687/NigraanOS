import {bindTranscript} from './transcriptionClient.js';
// Only self-owned, unpublished change drafts may be cleaned up. A lost committed
// response is reconciled before deleting any newly uploaded object.
export async function submitCitizenChange(client,input,attachments,userId,onProgress=()=>{}) {
  const id=crypto.randomUUID();const paths=[];const bucket=client.storage.from('incident-evidence');
  try {
    onProgress('Preparing report change…');
    const begun=await client.rpc('nigraan_begin_citizen_change',{change_id:id,incident:input.incidentId,change_kind:input.kind,fields:input.fields||null,update_text:input.body||'',expected_version:input.expectedVersion||null});
    if(begun.error)throw begun.error;
    const records=[];
    for(const attachment of attachments) {
      const mime=attachment.file.type.split(';')[0];const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a'}[mime];
      if(!extension)throw new Error('Unsupported evidence file.');
      const path=userId+'/'+input.incidentId+'/'+id+'/'+crypto.randomUUID()+'.'+extension;paths.push(path);
      onProgress('Uploading private evidence…');const uploaded=await bucket.upload(path,attachment.file,{contentType:mime,upsert:false});if(uploaded.error)throw uploaded.error;
      const record={storage_path:path,source:attachment.source};
      if(attachment.transcription?.jobId){await bindTranscript(client,attachment.transcription.jobId,path);Object.assign(record,{transcription_job:attachment.transcription.jobId,transcript:attachment.transcription.text,transcript_reviewed:attachment.transcription.reviewed===true});}
      else if(attachment.transcription?.status==='failed')record.transcription_status='failed';
      records.push(record);
    }
    onProgress('Saving report activity…');const final=await client.rpc('nigraan_finalize_citizen_change',{change_id:id,attachments:records});if(final.error)throw final.error;
    return input.incidentId;
  } catch(cause) {
    let outcome;try{outcome=await client.from('nigraan_citizen_changes').select('submission_state').eq('id',id).maybeSingle();}catch{outcome={error:true};}
    if(outcome.error)throw new Error('Could not confirm whether this change saved. Refresh report activity before retrying. Reference: '+id);
    if(outcome.data?.submission_state==='published')return input.incidentId;
    if(outcome.data?.submission_state==='draft'){
      try {
        if(paths.length){const removed=await bucket.remove(paths);if(removed.error)throw removed.error;}
        const abandoned=await client.rpc('nigraan_abandon_citizen_change',{change_id:id});if(abandoned.error)throw abandoned.error;
      }catch{throw new Error('The change was not published, but private draft cleanup needs administrator help. Reference: '+id);}
    }
    throw new Error(cause.message||'Report change failed.');
  }
}
