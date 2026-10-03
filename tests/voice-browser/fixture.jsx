import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import useTranscription from '../../src/hooks/useTranscription';
import VoiceTranscript from '../../src/components/VoiceTranscript';
import EvidenceTranscript from '../../src/components/EvidenceTranscript';
import {setFailure} from './service';
import '../../src/index.css';
function Fixture() {
  const [audio,setAudio]=useState(null);const [recording,setRecording]=useState(false);
  const transcription=useTranscription(audio);
  return <main className="citizen-main"><p className="verification-note">LOCAL UI TEST FIXTURE · Synthetic text/recording states · No microphone, Supabase or Groq requests</p>
    <section className="citizen-panel"><h2>Optional voice transcription · UI test</h2>
      <button onClick={()=>setFailure(true)}>Test failure mode</button> <button onClick={()=>setFailure(false)}>Test success mode</button>
      {!audio&&!recording&&<button onClick={()=>setRecording(true)}>Start test recording</button>}
      {recording&&<p role="status">Recording state fixture <button onClick={()=>{setRecording(false);setAudio(new Blob(['test'],{type:'audio/webm'}));}}>Stop test recording</button></p>}
      {audio&&<><p className="muted">Audio state attached (synthetic; not playable audio).</p><button onClick={()=>setAudio(null)}>Delete and re-record</button>
        <VoiceTranscript state={transcription.state} onTranscribe={transcription.transcribe} onLanguage={transcription.language} onEdit={value=>transcription.dispatch({type:'edit',value})} onReview={value=>transcription.dispatch({type:'review',value})} onSkip={transcription.skip}/></>}
    </section>
    {transcription.state.jobId&&<section className="citizen-panel"><h3>Operations display preview · same fixture text</h3><EvidenceTranscript file={{transcript:transcription.state.text,machine_transcript:transcription.state.machineText,transcription_status:transcription.state.reviewed?'confirmed':'ready'}}/></section>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
