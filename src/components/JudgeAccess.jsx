import {useState} from 'react';
import {judgeRpc,remainingAccessMs} from '../services/judgeAccess';
import JudgeCountdown from './JudgeCountdown';
export default function JudgeAccess({access,onRefresh,onOperations}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function request(){setBusy(true);setError('');try{await judgeRpc('nigraan_request_judge_access');onRefresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function activate(){setBusy(true);setError('');try{await judgeRpc('nigraan_activate_judge_access');onRefresh();}catch(e){setError(e.message);onRefresh();}finally{setBusy(false);}}
  const status=access?.status;
  if(access?.permanent)return null;
  const remaining=remainingAccessMs(access);
  return <section className="citizen-panel" aria-label="Temporary Operations access">
    <h2>Temporary Operations access for judges</h2>
    {(!status||status==='pending')&&<p>Request one temporary Operations session with your verified account. Administrator approval is required before you can start it.</p>}
    {status&&<p role="status"><strong>{status[0].toUpperCase()+status.slice(1)}</strong></p>}
    {status==='pending'&&<p>Your request is awaiting administrator approval.</p>}
    {access?.verificationUnavailable&&<p role="alert">Access verification is unavailable. Operations stays closed until the server confirms access.</p>}
    {status==='approved'&&<><p>Approved. Start within 48 hours of approval. Activate by {new Date(access.activation_expires_at).toLocaleString()}.</p><button className="primary" disabled={busy} onClick={activate}>{busy?'Starting…':'Start My 60-Minute Access'}</button></>}
    {status==='active'&&remaining>0&&<><p>Your 60 minutes started when you activated access. Workflow changes may remain after your access ends.</p><JudgeCountdown access={access}/><button className="primary" onClick={onOperations}>Open Operations</button></>}
    {(status==='expired'||status==='revoked')&&<p>Your approval or Operations session has ended. Citizen reporting remains available.</p>}
    {status==='rejected'&&<p>Your request was not approved. Contact the organizer if you need help.</p>}
    {!status&&<button className="primary" disabled={busy||!access} onClick={request}>{busy?'Submitting…':'Request Temporary Operations Access'}</button>}
    <button className="secondary" disabled={busy} onClick={onRefresh}>Check access status</button>
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
