import {useState} from 'react';
import {organizationTypes} from '../data/reportOptions';
import {applyOperations} from '../services/operations';
export default function OperationsApplication({operations,onRefresh}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const status=operations?.verification_status;
  async function submit(event) {
    event.preventDefault();
    const values=new FormData(event.currentTarget);
    setBusy(true);setError('');
    try {
      await applyOperations({organizationName:values.get('organizationName'),organizationType:values.get('organizationType'),explanation:values.get('explanation')});
      onRefresh();
    } catch(cause) {setError(cause.message);}
    finally {setBusy(false);}
  }
  return <section className="citizen-panel">
    <h2>Apply for Operations Access</h2>
    <p>Use your existing account and email. Citizen reporting remains available throughout verification.</p>
    {status && <p className="verification-note" role="status">{status==='pending'?'Pending Verification':status==='approved'?'Operations access approved':'Application rejected'} · {operations.organization_name}</p>}
    {status==='pending' && <p>Your application is awaiting project-owner approval.</p>}
    {status==='approved' && <p>Choose Operations in the workspace switcher to coordinate real incidents.</p>}
    {status==='rejected' && <p>You can update the organization details and submit a new application for review.</p>}
    {(!status || status==='rejected') && <form onSubmit={submit}><fieldset disabled={busy}>
      <label>Organization Name<input name="organizationName" required maxLength={200} defaultValue={operations?.organization_name || ''}/></label>
      <label>Organization Type<select name="organizationType" required defaultValue={operations?.organization_type || 'other'}>{organizationTypes.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>How does your organization contribute to the city? (optional)<textarea name="explanation" maxLength={1000} defaultValue={operations?.explanation || ''}/></label>
      <p className="muted">Submitting requests verification; it does not approve access.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy?'Submitting…':'Submit application'}</button>
    </fieldset></form>}
    <button className="secondary" disabled={busy} onClick={onRefresh}>Check verification status</button>
  </section>;
}
