import {requireSupabase} from './supabase';
import {submitCitizenChange} from './citizenChangeSubmission.js';
import {citizenFields} from '../utils/citizenChanges.js';
import {validatePhoto,validateAttachment} from '../utils/evidenceValidation.js';
export async function saveCitizenChange(input,photo,audio,transcription,userId,onProgress) {
  if(input.kind==='edit')input={...input,fields:citizenFields(input.fields)};
  else if(!input.body?.trim()||input.body.length>5000)throw new Error('Enter an update up to 5000 characters.');
  const attachments=[];
  if(photo){await validatePhoto(photo.file);attachments.push(photo);}
  if(audio){validateAttachment(audio,'audio');attachments.push({file:audio,source:'recording',transcription});}
  return submitCitizenChange(requireSupabase(),input,attachments,userId,onProgress);
}
export async function fetchCitizenActivity(incidentId) {
  const rows=[];const client=requireSupabase();
  for(let offset=0;;offset+=200){const result=await client.from('nigraan_citizen_changes').select('id,citizen_id,kind,body,original_snapshot,previous_values,new_values,published_at').eq('incident_id',incidentId).eq('submission_state','published').order('published_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+199);
    if(result.error)throw result.error;rows.push(...result.data);if(result.data.length<200)return rows;}
}
