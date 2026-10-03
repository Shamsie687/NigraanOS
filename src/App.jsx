import {useEffect} from 'react';
import useHashRoute from './hooks/useHashRoute';
import useAuth from './hooks/useAuth';
import EntryPage from './pages/EntryPage';
import CitizenPage from './pages/CitizenPage';
import OperationsPage from './pages/OperationsPage';
import AccountStatusPage from './pages/AccountStatusPage';
import {hasOperationsAccess} from './utils/workspaceAccess';

export default function App() {
  const [route, navigate] = useHashRoute();
  const auth = useAuth();
  const logout = async () => { await auth.logout(); navigate('/'); };
  useEffect(() => {
    if (auth.account) navigate('/citizen');
  }, [auth.account?.profile.id]);
  if (auth.loading) return <main className="citizen-main" role="status">Restoring your account…</main>;
  if (!auth.session) return <EntryPage />;
  if (auth.error || !auth.account) return <AccountStatusPage error={auth.error || 'Your profile is unavailable.'} onRefresh={auth.refreshAccount} onLogout={logout} />;
  const { profile, operations } = auth.account;
  const session = { name: profile.display_name, userId: profile.id };
  const onSwitch=workspace=>navigate('/'+workspace);
  // Database approval is additional workspace access; legacy account_type does
  // not remove Citizen access. RPCs/RLS independently enforce Operations rights.
  if (route==='/operations' && hasOperationsAccess(auth.account)) {
    return <OperationsPage key={profile.id} session={session} operations={operations} onSwitch={onSwitch} onExit={logout} onRefreshAccess={auth.refreshAccount}/>;
  }
  return <CitizenPage key={profile.id} session={session} operations={operations} onSwitch={onSwitch} onRefreshAccess={auth.refreshAccount} operationsRequested={route==='/operations'} onExit={logout}/>;
}


