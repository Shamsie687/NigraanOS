export default function WorkspaceSwitcher({workspace,operations,onSwitch,onRefresh,disabled=false}) {
  const approved=operations?.verification_status==='approved';
  return <nav className="workspace-switcher" aria-label="Workspace">
    <button disabled={disabled} aria-pressed={workspace==='citizen'} onClick={()=>onSwitch('citizen')}>Citizen</button>
    <button disabled={disabled} aria-pressed={workspace==='operations'} onClick={()=>onSwitch('operations')}>
      Operations{!approved && (operations ? ' · '+(operations.verification_status==='pending'?'Pending verification':operations.verification_status) : ' · Apply')}
    </button>
    <button disabled={disabled} onClick={onRefresh}>Refresh access</button>
  </nav>;
}
