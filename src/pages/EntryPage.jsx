import { useState } from 'react';
import Brand from '../components/Brand';
import {signIn, signUp} from '../services/auth';
import {configurationError} from '../services/supabase';
export default function EntryPage() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      if (register) {
        if (!values.get('name').trim()) throw new Error('Enter your full name.');
        const result = await signUp({
          fullName: values.get('name'), email: values.get('email').trim(),
          password: values.get('password'),
        });
        if (!result.session) {
          setNotice('Check your email to confirm your account, then sign in. If this email already has an account, sign in instead.');
          form.reset(); setRegister(false);
        }
      } else {
        await signIn({ email: values.get('email').trim(), password: values.get('password') });
      }
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <main className="entry">
  <header className="entry-header">
    <Brand />
    <span className="eyebrow">CITY INTELLIGENCE. COLLECTIVE ACTION.</span>
    <span className="demo-tag">Citizen & Operations</span>
  </header>
  <div className="entry-grid">
    <section className="entry-story">
      <div className="eyebrow accent">CONNECTED CITIES / PAKISTAN</div>
      <h1>A better city starts<br />with a clear picture.</h1>
      <p>From the street to the command center. Report what matters, coordinate a response, and bring your city closer together.</p>
      <div className="city-illustration" aria-hidden="true">
        <div className="orbit" />
        {[42, 70, 55, 100, 85, 130, 68, 108, 56].map((height, i) => <i key={i} style={{
            height: height + 'px'
          }} />)}
        <span className="city-caption">KARACHI · FIRST DEMONSTRATION CITY</span>
      </div>
      <div className="entry-facts">
        <span>
          <strong>01</strong> Report & locate</span>
        <span>
          <strong>02</strong> Coordinate & act</span>
        <span>
          <strong>03</strong> Track & resolve</span>
      </div>
    </section>
    <section className="entry-card">
      <div className="eyebrow">ONE ACCOUNT. MULTIPLE WORKSPACES.</div>
      <h2>Welcome to NigraanOS</h2>
      <p>Sign in to report incidents. Apply for Operations access from the same account.</p>
      <form onSubmit={submit}>
        <div className="form-heading">
          <h3>
            {register ? 'Create account' : 'Sign in'}
          </h3>
          <button type="button" className="text-button" disabled={busy} onClick={() => {setRegister(!register);setError("");setNotice("");}}>
            {register ? 'Sign in instead' : 'Create account'}
          </button>
        </div>
        {register && <label>Full name<input name="name" maxLength={120} required placeholder="Your full name" />
        </label>}
        {configurationError && <div className="notice" role="status"><h3>Backend setup required</h3><p>{configurationError}</p></div>}
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="success" role="status">{notice}</p>}
        <label>Email<input type="email" name="email" required placeholder="you@example.com" autoComplete="email" />
        </label>
        <label>Password<input type="password" name="password" required minLength={8} placeholder="At least 8 characters" autoComplete={register ? 'new-password' : 'current-password'} />
        </label>
        <button className="primary full" type="submit" disabled={busy || !!configurationError}>
          {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'} →</button>
      </form><p className="small muted">Every account has Citizen access. Operations is an additional workspace requiring organization approval.</p>
    </section>
  </div>
  <footer className="entry-footer">NigraanOS / Digital twin & city management <span>Built for cities. Designed for people.</span>
  </footer>
</main>;
}

