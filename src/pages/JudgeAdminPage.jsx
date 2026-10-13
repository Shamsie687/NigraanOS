import {useEffect,useState} from 'react';
import {judgeRpc} from '../services/judgeAccess';
const time=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})+' PKT':'—';
export default function JudgeAdminPage({onExit}) {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){try{setData(await judgeRpc('nigraan_list_judge_requests'));setError('');}catch(e){setData(null);setError(e.message);}}
  useEffect(()=>{refresh();},[]);
  async function action(name,args){setBusy(true);setError('');try{await judgeRpc(name,args);await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <main className="citizen-main"><h1>Judge access review</h1><p>Approval allows one activation within 48 hours. The judge starts their own 60-minute session. Notification delivery changes neither deadline.</p>
    <button className="secondary" onClick={onExit}>Back to Citizen</button><button className="secondary" disabled={busy} onClick={refresh}>Refresh requests</button>
    {error&&<p role="alert" className="error">{error}</p>}
    {data?.requests.map(r=><section className="citizen-panel" key={r.id}><h2>{r.registered_email}</h2><p>{r.status} · Requested {time(r.requested_at)}</p><p>Approved {time(r.approved_at)} · Activate by {time(r.activation_expires_at)} · Started {time(r.started_at)} · Expires {time(r.expires_at)}</p>
      {r.status==='pending'&&<><button disabled={busy} onClick={()=>action('nigraan_decide_judge_access',{request_id:r.id,decision:'approved'})}>Approve activation</button><button disabled={busy} onClick={()=>action('nigraan_decide_judge_access',{request_id:r.id,decision:'rejected'})}>Reject</button></>}
      {['approved','active'].includes(r.status)&&<button disabled={busy} onClick={()=>action('nigraan_decide_judge_access',{request_id:r.id,decision:'revoked'})}>Revoke access</button>}
    </section>)}
    {data&&<section className="citizen-panel"><h2>Notification delivery</h2>{data.emails.map(e=><p key={e.id}>{e.event} · {e.state} · attempts {e.attempts}{e.failure_code?' · '+e.failure_code:''} {['pending','failed'].includes(e.state)&&!['delivery_unknown','timeout'].includes(e.failure_code)&&<button disabled={busy} onClick={()=>action('nigraan_retry_judge_email',{job_id:e.id})}>Retry notification</button>}</p>)}</section>}
    {data&&<section className="citizen-panel"><h2>Decision audit</h2>{data.audit.map((e,i)=><p key={i}>{data.requests.find(r=>r.id===e.request_id)?.registered_email||'Earlier request'} · {e.action} · {time(e.recorded_at)}</p>)}</section>}
  </main>;
}
