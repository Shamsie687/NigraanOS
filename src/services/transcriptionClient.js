import {validateAttachment} from '../utils/evidenceValidation.js';
import {TRANSCRIPT_LIMIT} from '../utils/transcriptState.js';
export async function invokeTranscription(client, body, signal) {
  const {data,error} = await client.functions.invoke('transcribe-recording', {body, signal});
  if (error) {
    let message = 'Transcription is unavailable. Check the Edge Function setup or retry. Your recording is still available.';
    try {
      const result = await error.context?.json();
      if (typeof result?.error==='string') message=result.error;
      if (['app_quota_short','app_quota_daily','provider_rate_limited'].includes(result?.code) && Number.isFinite(result.retryAfter) && result.retryAfter>0) {
        message+=' Try again in about '+Math.ceil(result.retryAfter/60)+' minute(s).';
      }
    } catch { /* Never display raw infrastructure/provider responses. */ }
    throw new Error(message);
  }
  return data;
}
export async function transcribeRecording(client, audio, language='auto', signal) {
  const mime=validateAttachment(audio,'audio');
  if (!['auto','ur','en'].includes(language)) throw new Error('Choose automatic, Urdu or English.');
  const form=new FormData();
  form.append('audio',audio,'recording.'+({'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a'}[mime]));
  form.append('language',language);
  const result=await invokeTranscription(client,form,signal);
  if (typeof result?.text!=='string' || !result.text.trim() || result.text.length>TRANSCRIPT_LIMIT || !/^[0-9a-f-]{36}$/i.test(result.jobId||'')) {
    throw new Error('No usable transcript was returned. Keep the audio or retry.');
  }
  return result;
}
export async function bindTranscript(client, jobId, path) {
  const data=await invokeTranscription(client,{action:'bind',jobId,storagePath:path});
  if (data?.bound!==true) throw new Error('Transcript could not be attached. Keep audio without transcript and retry submission.');
}
