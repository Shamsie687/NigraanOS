import {TRANSCRIPT_LIMIT} from '../utils/transcriptState.js';
export default function VoiceTranscript({state,onTranscribe,onLanguage,onEdit,onReview,onSkip}) {
  return <div className="voice-transcript">
    <p className="muted">Transcription supports Urdu and English. For mixed speech, try automatic detection and review the result.</p>
    <label>Recording language<select value={state.selectedLanguage} disabled={state.status==='loading'} onChange={event=>onLanguage(event.target.value)}>
      <option value="auto">Automatic / mixed Urdu + English</option><option value="ur">Urdu</option><option value="en">English</option>
    </select></label>
    <p className="verification-note">Transcribe sends this recording through our authenticated server to Groq for speech recognition. Original audio remains private in NigraanOS after submission.</p>
    <button type="button" disabled={state.status==='loading'} onClick={onTranscribe}>{state.status==='loading'?'Transcribing recording…':state.status==='failed'?'Retry transcription':state.jobId?'Transcribe again':'Transcribe recording'}</button>
    {state.status==='loading'&&<p role="status">Processing audio… Wait for the new result, or choose Keep audio without transcript to submit now.</p>}
    {state.error&&<p role="alert" className="error">{state.error} You can submit with audio only.</p>}
    {state.jobId&&<div>
      <label>Machine-generated transcript · edit or correct<textarea dir="auto" rows={5} disabled={state.status==='loading'} maxLength={TRANSCRIPT_LIMIT} value={state.text} onChange={event=>onEdit(event.target.value)} /></label>
      <p className="verification-note">Machine-generated; may contain mistakes. Corrections are retained separately from the original machine transcript. Review against the recording before submitting.</p>
      <label className="transcript-review"><input type="checkbox" checked={state.reviewed} onChange={event=>onReview(event.target.checked)} />I reviewed this transcript</label>
    </div>}
    <button type="button" className="secondary" onClick={onSkip}>Keep audio without transcript</button>
    {state.status==='skipped'&&<p role="status">Audio will be kept without a transcript. You can transcribe again before submitting.</p>}
  </div>;
}
