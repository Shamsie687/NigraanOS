import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { loadAccount, signOut } from '../services/auth';
import {loadOperationsAccess,remainingAccessMs} from '../services/judgeAccess';

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
  useEffect(()=>{
    if(!userId)return;
    let stopped=false,inFlight=false;
    async function recheck(){
      if(inFlight||stopped)return;inFlight=true;
      try{const access=await loadOperationsAccess();if(!stopped)setAccount(current=>current?.profile.id===userId?{...current,access}:current);}
      catch{if(!stopped)setAccount(current=>current?{...current,access:{...current.access,allowed:false,admin:false,verificationUnavailable:true}}:current);}
      finally{inFlight=false;}
    }
    const resume=()=>{if(document.visibilityState==='visible')recheck();};
    const denied=()=>{setAccount(current=>current&&!current.access?.permanent?{...current,access:{...current.access,allowed:false}}:current);void recheck();};
    const poll=setInterval(recheck,15000);
    document.addEventListener('visibilitychange',resume);window.addEventListener('online',recheck);window.addEventListener('nigraan-access-denied',denied);
    return()=>{stopped=true;clearInterval(poll);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',recheck);window.removeEventListener('nigraan-access-denied',denied);};
  },[userId]);
  useEffect(()=>{
    const access=account?.access;if(!access?.allowed||access.permanent)return;
    const expire=()=>setAccount(current=>current?.access?.expires_at===access.expires_at?{...current,access:{...current.access,allowed:false,status:'expired'}}:current);
    const timer=setTimeout(expire,remainingAccessMs(access)+1);
    return()=>clearTimeout(timer);
  },[account?.access]);
  const logout = useCallback(async () => {
    try { await signOut(); setAccount(null); setSession(null); setError(''); }
    catch (cause) { setError('Sign out failed: ' + cause.message); }
  }, []);
  return { session, account, loading, error, refreshAccount, logout };
}
