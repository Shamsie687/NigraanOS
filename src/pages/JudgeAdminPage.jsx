import {useEffect,useState} from 'react';
import {judgeRpc} from '../services/judgeAccess';
const time=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})+' PKT':'-';
export function JudgeRequestReview({request:r,busy,onAction}) {
  const [deadline,setDeadline]=useState(''),[error,setError]=useState('');
  const reviewable=['pending','expired'].includes(r.status);
  function decide(decision){
    setError('');
    const args={request_id:r.id,decision,expected_cycle:r.cycle};
    if(['approved','renewed'].includes(decision)&&deadline){
      const at=new Date(deadline);
      if(!Number.isFinite(at.getTime())){setError('Choose a valid local date and time.');return;}
      args.activation_deadline=at.toISOString();
    }
    onAction('nigraan_review_judge_access',args);
  }
  return <section className="citizen-panel"><h2>{r.registered_email}</h2>
    <p>{r.status} · Cycle {r.cycle??1} · Requested {time(r.requested_at)}</p>
    <p>Approved {time(r.approved_at)} · Activate by {time(r.activation_expires_at)} · Started {time(r.started_at)} · Expires {time(r.expires_at)}</p>
    {reviewable&&<><label>Optional activation deadline (your browser local time)
      <input type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)} disabled={busy}/>
    </label><p>Leave blank for 48 hours from approval. The server accepts only a future deadline within 45 days. Starting access creates a 12-hour session.</p></>}
    {r.status==='pending'&&<><button disabled={busy} onClick={()=>decide('approved')}>Approve activation</button><button disabled={busy} onClick={()=>decide('rejected')}>Reject</button></>}
    {r.status==='expired'&&<button disabled={busy} onClick={()=>decide('renewed')}>Renew expired access</button>}
    {['approved','active'].includes(r.status)&&<button disabled={busy} onClick={()=>decide('revoked')}>Revoke access</button>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
export default function JudgeAdminPage({onExit}) {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh(){try{setData(await judgeRpc('nigraan_list_judge_requests'));setError('');}catch(e){setData(null);setError(e.message);}}
  useEffect(()=>{refresh();},[]);
  async function action(name,args){setBusy(true);setError('');try{await judgeRpc(name,args);await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <main className="citizen-main"><h1>Judge access review</h1>
    <p>Judges activate their own 12-hour session before the approval deadline. Active sessions cannot be extended. Only expired approvals/sessions can be renewed by an administrator; revoked and rejected requests cannot be renewed here. Notification delivery changes neither deadline.</p>
    <button className="secondary" onClick={onExit}>Back to Citizen</button><button className="secondary" disabled={busy} onClick={refresh}>Refresh requests</button>
    {error&&<p role="alert" className="error">{error}</p>}
    {data?.requests.map(r=><JudgeRequestReview key={r.id+':'+r.cycle} request={r} busy={busy} onAction={action}/>)}
    {data&&<section className="citizen-panel"><h2>Notification delivery</h2>{data.emails.map(e=><p key={e.id}>Cycle {e.cycle??1} · {e.event} · {e.state} · attempts {e.attempts}{e.failure_code?' · '+e.failure_code:''} {data.requests.some(r=>r.id===e.request_id&&r.cycle===e.cycle)&&['pending','failed'].includes(e.state)&&!['delivery_unknown','timeout'].includes(e.failure_code)&&<button disabled={busy} onClick={()=>action('nigraan_retry_judge_email',{job_id:e.id})}>Retry notification</button>}</p>)}</section>}
    {data&&<section className="citizen-panel"><h2>Decision audit</h2>{data.audit.map((e,i)=><div key={i}><p>{data.requests.find(r=>r.id===e.request_id)?.registered_email||'Earlier request'} · Cycle {e.cycle??1} · {e.action} · {time(e.recorded_at)}</p>{e.previous_grant&&<p>Previous cycle {e.previous_grant.cycle}: approved {time(e.previous_grant.approved_at)} · activate by {time(e.previous_grant.activation_expires_at)} · started {time(e.previous_grant.started_at)} · expired {time(e.previous_grant.expires_at)}</p>}</div>)}</section>}
  </main>;
}
