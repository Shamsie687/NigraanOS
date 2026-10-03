import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { loadAccount, signOut } from '../services/auth';

export default function useAuth() {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const currentUserId = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    // Keep the callback synchronous; profile queries run in a separate effect.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextId = nextSession?.user.id || null;
      if (nextId !== currentUserId.current) {
        currentUserId.current = nextId;
        setAccount(null);
        setError('');
        setLoading(Boolean(nextId));
      }
      setSession(nextSession);
      if (!nextId) setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setAccount(null);
    setError('');
    loadAccount(userId).then(value => {
      if (!cancelled) setAccount(value);
    }).catch(cause => {
      if (!cancelled) setError(cause.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, revision]);

  const refreshAccount = useCallback(() => setRevision(value => value + 1), []);
  const logout = useCallback(async () => {
    try { await signOut(); setAccount(null); setSession(null); setError(''); }
    catch (cause) { setError('Sign out failed: ' + cause.message); }
  }, []);
  return { session, account, loading, error, refreshAccount, logout };
}
