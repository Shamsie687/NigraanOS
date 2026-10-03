import {useEffect,useRef,useState} from 'react';
import {reportCategories} from '../data/reportOptions';
import useVoiceRecorder from '../hooks/useVoiceRecorder';
import useTranscription from '../hooks/useTranscription';
import useObjectUrl from '../hooks/useObjectUrl';
import VoiceTranscript from './VoiceTranscript';
import {submissionTranscript} from '../utils/transcriptState.js';
import {validatePhoto} from '../utils/evidenceValidation.js';
import {saveCitizenChange} from '../services/citizenChanges';
export default function CitizenChangeForm({incident,kind,userId,onSaved,onCancel,onBusy,onRefresh}) {
  const [gps,setGps]=useState({latitude:incident.latitude,longitude:incident.longitude,location_accuracy:incident.location_accuracy});
  const [photo,setPhoto]=useState(null);const [busy,setBusy]=useState(false);const [locating,setLocating]=useState(false);const [checking,setChecking]=useState(false);const [error,setError]=useState('');const [progress,setProgress]=useState('');
  const alive=useRef(true);const photoVersion=useRef(0);useEffect(()=>{alive.current=true;return()=>{alive.current=false;photoVersion.current++;};},[]);
  const expectedVersion=useRef(incident.updated_at);
  const voice=useVoiceRecorder();const transcription=useTranscription(voice.audio);const audioUrl=useObjectUrl(voice.audio);const photoUrl=useObjectUrl(photo?.file);
  function locate(){setError('');if(!navigator.geolocation){setError('Location is unavailable. Keep the existing GPS or use a supported browser.');return;}setLocating(true);navigator.geolocation.getCurrentPosition(position=>{if(alive.current){setGps({latitude:position.coords.latitude,longitude:position.coords.longitude,location_accuracy:position.coords.accuracy,capturedAt:Date.now()});setLocating(false);}},()=>{if(alive.current){setError('Unable to attach current location. Existing GPS has been retained.');setLocating(false);}},{enableHighAccuracy:true,maximumAge:0,timeout:20000});}
  async function choosePhoto(event){const file=event.target.files[0];event.target.value='';if(!file)return;const version=++photoVersion.current;setChecking(true);setError('');try{await validatePhoto(file);if(alive.current&&version===photoVersion.current)setPhoto({file,source:'upload'});}catch(cause){if(alive.current)setError(cause.message);}finally{if(alive.current&&version===photoVersion.current)setChecking(false);}}
  async function submit(event){event.preventDefault();setError('');if(voice.recording||voice.starting||checking||locating||transcription.state.status==='loading'){setError('Finish recording/transcription, or keep audio without a transcript.');return;}if(gps.capturedAt&&Date.now()-gps.capturedAt>300000){setError('The new GPS attachment expired. Capture your location again.');return;}
    const values=new FormData(event.currentTarget);setBusy(true);onBusy(true);
    try{await saveCitizenChange({incidentId:incident.id,kind,expectedVersion:expectedVersion.current,fields:kind==='edit'?{title:values.get('title'),description:values.get('description'),category:values.get('category'),area:values.get('area'),...gps}:null,body:values.get('body')||''},photo,voice.audio,voice.audio?submissionTranscript(transcription.state):null,userId,setProgress);await onSaved();}
    catch(cause){if(alive.current)setError(cause.message);await onRefresh();}finally{if(alive.current){setBusy(false);setProgress('');}onBusy(false);}}
  return <section className="citizen-panel"><h3>{kind==='edit'?'Edit Report':'Add Update'}</h3><p className="verification-note">{kind==='edit'?'Original fields can be corrected only before acknowledgement. Changes are recorded in history.':'Updates are appended to the report. Earlier updates and the original report cannot be rewritten.'} Existing evidence stays intact; optional files are added separately.</p>
    <form onSubmit={submit}><fieldset disabled={busy}>{kind==='edit'?<>
      <label>Title<input name="title" defaultValue={incident.title} required maxLength={160}/></label><label>Description<textarea dir="auto" name="description" defaultValue={incident.description} required maxLength={5000} rows={4}/></label>
      <label>Category<select name="category" defaultValue={incident.category}>{reportCategories.map(category=><option key={category.id} value={category.id}>{category.label}</option>)}</select></label><label>Area<input name="area" defaultValue={incident.area||''} required maxLength={200}/></label>
      <p>GPS: {gps.latitude}, {gps.longitude}</p><button type="button" disabled={locating} onClick={locate}>{locating?'Attaching location…':'Use my current location'}</button>
    </>:<label>Clarification / update<textarea dir="auto" name="body" required rows={4} maxLength={5000} placeholder="What has changed or what should the team know?"/></label>}
      <label>Additional photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={checking} onChange={choosePhoto}/></label><small>JPG, PNG or WebP · up to 5 MB</small>
      {photo&&<div className="photo-preview"><img src={photoUrl||undefined} alt="Additional report evidence"/><button type="button" onClick={()=>setPhoto(null)}>Remove new photo</button></div>}
      <h4>Additional voice evidence (optional)</h4><small>Up to 2 minutes / 10 MB</small>
      {!voice.audio&&!voice.recording&&<button type="button" disabled={!voice.supported||voice.starting} onClick={voice.start}>{voice.starting?'Requesting microphone…':'Start recording'}</button>}
      {voice.recording&&<p role="status">Recording · {voice.seconds}s <button type="button" onClick={voice.stop}>Stop recording</button></p>}
      {voice.audio&&<><audio controls src={audioUrl||undefined}/><button type="button" onClick={voice.clear}>Delete and re-record</button><VoiceTranscript state={transcription.state} onTranscribe={transcription.transcribe} onLanguage={transcription.language} onEdit={value=>transcription.dispatch({type:'edit',value})} onReview={value=>transcription.dispatch({type:'review',value})} onSkip={transcription.skip}/></>}
      {voice.error&&<p role="alert" className="error">{voice.error}</p>}{error&&<p role="alert" className="error">{error}</p>}{progress&&<p role="status">{progress}</p>}
      <div className="evidence-actions"><button className="primary" disabled={busy||voice.recording||voice.starting||checking||locating||transcription.state.status==='loading'}>{busy?'Saving…':'Save '+(kind==='edit'?'changes':'update')}</button><button type="button" onClick={onCancel}>Cancel</button></div>
    </fieldset></form></section>;
}
