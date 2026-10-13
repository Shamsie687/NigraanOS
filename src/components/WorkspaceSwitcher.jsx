export default function WorkspaceSwitcher({workspace,operations,access,onSwitch,onRefresh,disabled=false}) {
  const approved=access?access.allowed:operations?.verification_status==='approved';
  const ended=access&&!access.permanent&&['expired','revoked'].includes(access.status);
  return <nav className="workspace-switcher" aria-label="Workspace">
    <button disabled={disabled} aria-pressed={workspace==='citizen'} onClick={()=>onSwitch('citizen')}>Citizen</button>
    {!ended&&<button disabled={disabled} aria-pressed={workspace==='operations'} onClick={()=>onSwitch('operations')}>
      Operations{access?.status==='approved'?' · Ready to start':''}{!approved && (operations ? ' · '+(operations.verification_status==='pending'?'Pending verification':operations.verification_status) : ' · Apply')}
    </button>}
    {ended&&<span role="status">Operations session ended</span>}
    <button disabled={disabled} onClick={onRefresh}>Refresh access</button>
  </nav>;
}
