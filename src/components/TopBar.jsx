import { useState, useEffect } from 'react';
import { city, alerts } from '../data/mockData';
import {displayInitials} from '../utils/commandCenter';
export default function TopBar({
  session,realIncidents=false,showDemo=false
}) {
  const [time, setTime] = useState(new Date());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <header className="topbar">
  <div className="topbar-left">
    <div>
      <div className="topbar-title">
        {city.name} Command Center</div>
      <small className="muted">Operations workspace</small>
    </div>
    <span className="live-indicator">
      {realIncidents?'AUTHORIZED INCIDENTS':'WORKSPACE'}
    </span>
  </div>
  <div className="topbar-right">
    <time>
      {time.toLocaleString('en-GB', {
          timeZone: city.timezone,
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })}
      <small>PKT · UTC+5</small>
    </time>
    {showDemo&&<div className="notification-wrap">
      <button aria-label="Notifications" aria-expanded={open} onClick={() => setOpen(!open)} className="icon-button">♧<span className="notification-dot" />
      </button>
      {open && <div className="notification-panel">
        <h3>City notifications · Demo</h3>
        {alerts.map(a => <p key={a.title}>
          <strong>
            {a.title}
          </strong>
          <br />
          {a.detail}
        </p>)}
      </div>}
    </div>}
    <span className="avatar" title={session.name}>{displayInitials(session.name)}</span>
  </div>
</header>;
}
