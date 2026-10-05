import {useEffect} from 'react';
import useHashRoute from './hooks/useHashRoute';
import useAuth from './hooks/useAuth';
import EntryPage from './pages/EntryPage';
import CitizenPage from './pages/CitizenPage';
import OperationsPage from './pages/OperationsPage';
import AccountStatusPage from './pages/AccountStatusPage';
import AgentConsentPage from './pages/AgentConsentPage';
import AgentCallbackPage from './pages/AgentCallbackPage';
import {getSimulatorSession} from './services/mcpSimulatorRuntime';
import {hasOperationsAccess} from './utils/workspaceAccess';

export default function App() {
  const [route, navigate] = useHashRoute();
  const auth = useAuth();
  const logout = async () => { await getSimulatorSession().disconnect(); await auth.logout(); navigate('/'); };
  useEffect(()=>{if(auth.loading)return;const s=getSimulatorSession();void s.accountChanged(auth.session?.user?.id);},[auth.loading,auth.session?.user?.id]);
  useEffect(() => {
    if (auth.account && !window.location.hash.startsWith('#/agent-consent?') && !window.location.hash.startsWith('#/agent-callback')) navigate('/citizen');
  }, [auth.account?.profile.id]);
  if (auth.loading) return <main className="citizen-main" role="status">Restoring your account…</main>;
  if(route==='/agent-callback')return <AgentCallbackPage userId={auth.account?.profile.id} approved={hasOperationsAccess(auth.account)}/>;
  if (!auth.session) return <EntryPage />;
  if (auth.error || !auth.account) return <AccountStatusPage error={auth.error || 'Your profile is unavailable.'} onRefresh={auth.refreshAccount} onLogout={logout} />;
  const { profile, operations } = auth.account;
  const session = { name: profile.display_name, userId: profile.id };
  const onSwitch=workspace=>navigate('/'+workspace);
  if (route.startsWith('/agent-consent?')) return <AgentConsentPage key={profile.id} route={route} userId={profile.id}/>;
  // Database approval is additional workspace access; legacy account_type does
  // not remove Citizen access. RPCs/RLS independently enforce Operations rights.
  if (route==='/operations' && hasOperationsAccess(auth.account)) {
    return <OperationsPage key={profile.id} session={session} operations={operations} onSwitch={onSwitch} onExit={logout} onRefreshAccess={auth.refreshAccount}/>;
  }
  return <CitizenPage key={profile.id} session={session} operations={operations} onSwitch={onSwitch} onRefreshAccess={auth.refreshAccount} operationsRequested={route==='/operations'} onExit={logout}/>;
}


