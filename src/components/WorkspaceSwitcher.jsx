export default function WorkspaceSwitcher({workspace,operations,access,onSwitch,onRefresh,disabled=false}) {
  const approved=access?access.allowed:operations?.verification_status==='approved';
  const ended=access&&!access.permanent&&['expired','revoked'].includes(access.status);
  const temporaryStatus=!access?.permanent&&access?.status;
  const temporaryLabel=access?.verificationUnavailable?'Verification unavailable':({pending:'Judge approval pending',approved:'Ready to start',active:approved?'Temporary session active':'Check access status',rejected:'Judge request rejected'})[temporaryStatus];
  return <nav className="workspace-switcher" aria-label="Workspace">
    <button disabled={disabled} aria-pressed={workspace==='citizen'} onClick={()=>onSwitch('citizen')}>Citizen</button>
    {!ended&&<button disabled={disabled} aria-pressed={workspace==='operations'} onClick={()=>onSwitch('operations')}>
      Operations{temporaryLabel?' · '+temporaryLabel:!approved && (operations ? ' · '+(operations.verification_status==='pending'?'Pending verification':operations.verification_status) : ' · Apply')}
    </button>}
    {ended&&<span role="status">Operations session ended</span>}
    <button disabled={disabled} onClick={onRefresh}>Refresh access</button>
  </nav>;
}
