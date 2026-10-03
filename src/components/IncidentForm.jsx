import { useEffect, useRef, useState } from 'react';
import { reportCategories } from '../data/reportOptions';
import { createReport } from '../services/reports';
import { validatePhoto } from '../utils/evidenceValidation';
import useVoiceRecorder from '../hooks/useVoiceRecorder';
import useObjectUrl from '../hooks/useObjectUrl';
import useTranscription from '../hooks/useTranscription';
import VoiceTranscript from './VoiceTranscript';
import {submissionTranscript} from '../utils/transcriptState.js';

export default function IncidentForm({ userId, onSaved, onBusy }) {
  const [gps, setGps] = useState(null);
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [validating, setValidating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const voice = useVoiceRecorder();
  const transcription = useTranscription(voice.audio);
  const photoUrl = useObjectUrl(photo?.file);
  const audioUrl = useObjectUrl(voice.audio);
  const alive = useRef(true);
  const photoVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; photoVersion.current++; }; }, []);
  function locate() {
    setError(''); setGps(null);
    if (!navigator.geolocation) { setError('Geolocation is unavailable. Use a browser with location support.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (!alive.current) return;
      setGps({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: Date.now() });
      setLocating(false);
    }, cause => {
      if (!alive.current) return;
      setLocating(false);
      setError(cause.code === 1 ? 'Location permission was denied. Allow location access and try again.' : 'Unable to attach GPS. Check your device location settings and try again.');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  async function choosePhoto(event, source) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const version = ++photoVersion.current;
    setValidating(true); setError(''); setPhoto(null);
    try {
      await validatePhoto(file);
      // Check that browser can actually decode this image, not just its extension.
      const url = URL.createObjectURL(file);
      try {
        await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error('Image has no dimensions.'));
          image.onerror = () => reject(new Error('Unable to decode this photo. Choose another image.'));
          image.src = url;
        });
      } finally { URL.revokeObjectURL(url); }
      if (alive.current && version === photoVersion.current) setPhoto({ file, source });
    } catch (cause) {
      if (alive.current && version === photoVersion.current) setError(cause.message);
    } finally { if (alive.current && version === photoVersion.current) setValidating(false); }
  }
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (transcription.state.status==='loading') {
      setError('Wait for transcription, or choose Keep audio without transcript before submitting.'); return;
    }
    if (!gps || !photo || voice.recording || voice.starting || validating) {
      setError('Attach GPS and a valid photo, and stop recording before submitting.'); return;
    }
    if (Date.now() - gps.capturedAt > 5 * 60 * 1000) {
      setGps(null); setError('Your GPS attachment expired. Use your current location again.'); return;
    }
    const values = new FormData(event.currentTarget);
    setBusy(true); onBusy(true);
    try {
      const reference=await createReport({
        title: values.get('title'), description: values.get('description'),
        category: values.get('category'), area: values.get('area'), ...gps,
      }, userId, photo, voice.audio, setProgress, voice.audio ? submissionTranscript(transcription.state) : null);
      await onSaved(reference);
    } catch (cause) { if (alive.current) setError(cause.message); }
    finally { if (alive.current) { setBusy(false); setProgress(''); } onBusy(false); }
  }
  return <section className="citizen-panel">
    <div className="page-heading"><h2>Report an incident</h2><span className="demo-tag">GPS + photo required</span></div>
    <p className="muted">Attach evidence so teams can understand and locate the issue. Avoid photographing private information or people without consent.</p>
    <div className="submission-readiness" aria-label="Evidence readiness"><span className={gps?'ready':''}>GPS · {gps?'Attached':'Required'}</span><span className={photo?'ready':''}>Photo · {photo?'Attached':'Required'}</span><span>Voice · Optional</span></div>
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>Category *<select name="category" required><option value="">Choose a category</option>{reportCategories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Title *<input name="title" required maxLength={160} placeholder="A short summary of the incident" /></label>
      <label>Description *<textarea name="description" required maxLength={5000} rows={4} placeholder="Describe the issue and who it affects…" /></label>
      <label>Location / area *<input name="area" required maxLength={200} placeholder="Area, street and nearest landmark" /></label>
      <div className="evidence-section"><h3>GPS location *</h3>
        <button type="button" className="secondary" disabled={locating} onClick={locate}>{locating ? 'Attaching GPS…' : 'Use my current location'}</button>
        <p className={gps ? 'accent' : 'muted'} role="status">{gps ? 'Location attached · ' + gps.latitude.toFixed(5) + ', ' + gps.longitude.toFixed(5) + ' · accuracy ±' + Math.round(gps.accuracy) + ' m' : 'No GPS location attached. Browser location permission is required.'}</p>
      </div>
      <div className="evidence-section"><h3>Photo evidence *</h3>
        <div className="evidence-actions">
          <label className="file-action">Take Photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={validating} onChange={event => choosePhoto(event, 'camera')} /></label>
          <label className="file-action">Upload Photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={validating} onChange={event => choosePhoto(event, 'upload')} /></label>
        </div>
        <small className="muted">JPG, PNG or WebP · Up to 5 MB. Camera capture depends on your device/browser.</small>
        {validating && <p role="status">Checking photo…</p>}
        {photo && <div className="photo-preview"><img src={photoUrl || undefined} alt="Selected incident evidence" /><p className="accent">Photo attached · {photo.file.name}</p><button type="button" onClick={() => setPhoto(null)}>Remove photo</button></div>}
      </div>
      <div className="evidence-section voice-section"><h3>◉ Voice report <span className="muted">(optional)</span></h3>
        <p className="muted">Explain the problem in your own words. Up to 2 minutes / 10 MB.</p>
        {!voice.supported && <p className="muted">Recording is unavailable in this browser. Voice is optional.</p>}
        {!voice.recording && !voice.audio && <button type="button" disabled={!voice.supported || voice.starting} onClick={voice.start}>{voice.starting ? 'Requesting microphone…' : 'Start recording'}</button>}
        {voice.recording && <div role="status"><span className="recording-dot" /> Recording · {voice.seconds}s <button type="button" onClick={voice.stop}>Stop recording</button></div>}
        {voice.audio && <div><audio controls src={audioUrl || undefined} /><button type="button" onClick={voice.clear}>Delete and re-record</button></div>}
        {voice.audio && <VoiceTranscript state={transcription.state} onTranscribe={transcription.transcribe} onLanguage={transcription.language} onEdit={value=>transcription.dispatch({type:'edit',value})} onReview={value=>transcription.dispatch({type:'review',value})} onSkip={transcription.skip} />}
        {voice.error && <p className="error" role="alert">{voice.error}</p>}
        {!voice.audio && <p className="verification-note">Optional transcription becomes available after recording. Requires the configured server-side transcription service.</p>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {progress && <p role="status" className="accent">{progress}</p>}
      {!busy&&<p className="submission-help muted" role="status">{locating?'Wait for GPS attachment.':validating?'Wait for the photo check.':voice.recording||voice.starting?'Finish recording before submitting.':transcription.state.status==='loading'?'Wait for transcription or choose Keep audio without transcript.':!gps&&!photo?'Attach GPS and a photo to enable submission.':!gps?'Attach GPS to enable submission.':!photo?'Attach a photo to enable submission.':'Evidence ready. Complete the required report fields to submit.'}</p>}
      <button className="primary" type="submit" disabled={busy || locating || validating || !gps || !photo || voice.recording || voice.starting || transcription.state.status==='loading'}>{busy ? 'Saving incident…' : 'Submit incident →'}</button>
    </fieldset></form>
  </section>;
}

