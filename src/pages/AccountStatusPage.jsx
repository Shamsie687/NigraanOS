import Brand from '../components/Brand';
export default function AccountStatusPage({ status, error, onRefresh, onLogout }) {
  const rejected = status === 'rejected';
  return <main className="citizen">
    <header className="citizen-header"><Brand /><button onClick={onLogout}>Sign out</button></header>
    <div className="citizen-main"><section className="citizen-panel">
      <span className="eyebrow accent">OPERATIONS ACCESS</span>
      <h1>{error ? 'Account access unavailable' : rejected ? 'Verification not approved' : 'Verification pending'}</h1>
      <p>{error || (rejected ? 'Your access request was not approved. Contact your platform administrator for a review.' : 'Your organization account has been registered. Operations access requires approval by a trusted platform administrator.')}</p>
      <p className="muted">The command center and city report feed are available only to approved Operations accounts.</p>
      <button className="primary" onClick={onRefresh}>Check access again</button>
    </section></div>
  </main>;
}
