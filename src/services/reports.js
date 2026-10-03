import { requireSupabase } from './supabase';
import {buildReport} from '../utils/reportValidation';
import {validatePhoto, validateAttachment} from '../utils/evidenceValidation';
import {submitIncident} from './incidentSubmission';

const incidentColumns = 'id,reporter_id,title,description,category,latitude,longitude,location_accuracy,area,status,priority,assigned_organization_id,reported_at,updated_at,submission_state';

export async function createReport(input, reporterId, photo, audio, onProgress, transcription=null) {
  const payload = buildReport(input, reporterId);
  if (!photo || !['camera','upload'].includes(photo.source)) throw new Error('Attach at least one valid photo.');
  await validatePhoto(photo.file);
  const attachments = [photo];
  if (audio) {
    validateAttachment(audio, 'audio');
    attachments.push({file:audio, source:'recording', transcription});
  }
  return submitIncident(requireSupabase(), payload, attachments, reporterId, onProgress);
}

export async function fetchReports({ citizenId, offset = 0, limit = 50 }) {
  let query = requireSupabase().from('incidents').select(incidentColumns, { count: 'exact' })
    .eq('submission_state', 'submitted')
    .order('reported_at', { ascending: false }).order('id', { ascending: false });
  if (citizenId) query = query.eq('reporter_id', citizenId);
  const { data, count, error } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return { reports: data, total: count };
}
