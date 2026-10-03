export default function EvidenceTranscript({file}) {
  if (!file.transcript) return <p className="muted">{file.transcription_status==='failed'?'Transcription failed; original audio retained.':'No transcript available. Original audio is retained.'}</p>;
  const reviewed=Boolean(file.transcript_reviewed_at) || file.transcription_status==='confirmed';
  return <div className="evidence-transcript">
    <h4>{reviewed?'Citizen-reviewed transcript':'Machine transcript'}</h4>
    <p className="transcript-text" dir="auto">{file.transcript}</p>
    <p className="verification-note">{reviewed?'Reviewed or corrected by the citizen; may still contain mistakes.':'Machine-generated and may contain mistakes.'} Compare with the original audio.</p>
    {reviewed&&file.machine_transcript&&<details><summary>Original machine transcript</summary><p className="transcript-text" dir="auto">{file.machine_transcript}</p></details>}
    {file.transcription_provider&&<small className="muted">{file.transcription_provider} · {file.transcription_model} · selected language: {file.selected_language==='auto'?'automatic':file.selected_language}{file.detected_language?' · detected: '+file.detected_language:''}</small>}
  </div>;
}
