import {useEffect,useRef,useState} from 'react';
import {requireSupabase} from '../services/supabase';
import {publishOperationsUpdate} from '../services/accountability';
export default function OperationsPublicUpdate({incident,onUpdated,resolution=false}) {
  const [body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const pending=useRef(false),receipt=useRef(null),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function submit(event){event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');setSuccess('');receipt.current ||= crypto.randomUUID();
    try{await publishOperationsUpdate(requireSupabase(),{incident:incident.id,body,requestId:receipt.current,resolution,expectedStatus:incident.status});if(active.current){receipt.current=null;setBody('');setSuccess('Published to the reporting Citizen.');await onUpdated();}}
    catch{if(active.current)setError('Unable to confirm publication. Retry the same message or refresh the incident.');}
    finally{pending.current=false;if(active.current)setBusy(false);}
  }
  return <form className="report-progress" onSubmit={submit}><h3>{resolution?'Resolve with a message':'Post progress update'}</h3><p className="verification-note">Visible to the reporting Citizen. Publish only information your organization can support. Do not include personal contact details or private evidence.</p>
    <label>{resolution?'Resolution message':'Progress message'}<textarea required maxLength={1000} value={body} disabled={busy} onChange={e=>{setBody(e.target.value);receipt.current=null;setSuccess('');}}/></label>
    <p className="muted">{body.length}/1000 characters · This message cannot be edited after publication.</p>
    {error&&<p role="alert" className="error">{error}</p>}{success&&<p role="status" className="success">{success}</p>}
    <button className="primary" disabled={busy||!body.trim()}>{busy?'Publishing…':resolution?'Publish message and mark Resolved':'Publish to Citizen'}</button>
  </form>;
}
