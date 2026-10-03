// Storage is not transactional with PostgreSQL. Keep newly created records as
// drafts until the final RPC verifies every object and commits evidence + state.
// Injecting the client makes failure/recovery behavior testable without credentials.
import {bindTranscript} from './transcriptionClient.js';
export async function submitIncident(client, payload, attachments, userId, onProgress = () => {}) {
  const incidentId = crypto.randomUUID();
  const bucket = client.storage.from('incident-evidence');
  const paths = [];
  try {
    onProgress('Creating incident draft…');
    const begun = await client.rpc('nigraan_begin_incident', { incident_id: incidentId, ...payload });
    if (begun.error) throw begun.error;
    const records = [];
    for (const attachment of attachments) {
      const mime = attachment.file.type.split(';')[0];
      const extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'audio/webm':'webm', 'audio/ogg':'ogg', 'audio/mp4':'m4a' }[mime];
      const path = userId + '/' + incidentId + '/' + crypto.randomUUID() + '.' + extension;
      // Include paths before upload: a lost upload response can still leave an object.
      paths.push(path);
      onProgress('Uploading ' + (attachment.source === 'recording' ? 'voice recording' : 'photo evidence') + '…');
      const uploaded = await bucket.upload(path, attachment.file, { contentType: mime, upsert: false });
      if (uploaded.error) throw uploaded.error;
      const record={ storage_path: path, source: attachment.source };
      if (attachment.source==='recording' && attachment.transcription?.jobId) {
        onProgress('Attaching transcript to the original recording…');
        await bindTranscript(client,attachment.transcription.jobId,path);
        record.transcription_job=attachment.transcription.jobId;
        record.transcript=attachment.transcription.text;
        record.transcript_reviewed=attachment.transcription.reviewed===true;
      } else if (attachment.source==='recording' && attachment.transcription?.status==='failed') record.transcription_status='failed';
      records.push(record);
    }
    onProgress('Verifying and finalizing incident…');
    const finalized = await client.rpc('nigraan_finalize_incident', { incident: incidentId, attachments: records });
    if (finalized.error) throw finalized.error;
    return incidentId;
  } catch (cause) {
    // Never destroy evidence if finalize committed but its response was lost.
    // Ownership/RLS and the RPCs independently prevent finalized cleanup.
    let state;
    try {
      state = await client.from('incidents').select('submission_state').eq('id', incidentId).maybeSingle();
    } catch {
      state = {error:true};
    }
    if (state.error) {
      throw new Error('Submission outcome could not be confirmed. Refresh My Reports before retrying. Reference: ' + incidentId);
    }
    if (state.data?.submission_state === 'submitted') return incidentId;
    if (!state.data) throw new Error(cause.message || 'Incident creation failed.');
    if (state.data.submission_state !== 'draft') {
      throw new Error('Submission outcome could not be confirmed. Refresh My Reports before retrying. Reference: ' + incidentId);
    }
    onProgress('Cleaning up the unfinished submission…');
    try {
      if (paths.length) {
        const removed = await bucket.remove(paths);
        if (removed.error) throw removed.error;
      }
      const abandoned = await client.rpc('nigraan_abandon_draft', { incident: incidentId });
      if (abandoned.error) throw abandoned.error;
    } catch {
      throw new Error('Submission failed and its private draft could not be fully cleaned up. No final incident was published. Reference: ' + incidentId + '. Refresh My Reports and contact your administrator before retrying. Cause: ' + (cause.message || 'Evidence submission failed.'));
    }
    throw new Error(cause.message || 'Evidence upload failed; the unfinished submission was cleaned up.');
  }
}

