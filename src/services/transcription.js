import {requireSupabase} from './supabase';
import {transcribeRecording} from './transcriptionClient.js';
export function transcribeEvidence(audio,language,signal) {
  return transcribeRecording(requireSupabase(),audio,language,signal);
}
