import {useCallback,useEffect,useRef,useState} from 'react';
import {requireSupabase} from '../services/supabase';
import {fetchMapIncidents,observeIncidentChanges} from '../services/incidentMapData';
export default function useOperationalIncidents() {
  const [reports,setReports]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [realtimeStatus,setRealtimeStatus]=useState('connecting');
  const [lastUpdated,setLastUpdated]=useState(null);
  const controller=useRef(null);
  const mounted=useRef(false);
  const refresh=useCallback(async()=>{
    if(!mounted.current)return;
    controller.current?.abort();
    const request=new AbortController();
    controller.current=request;
    setLoading(true);setError('');
    try {
      const rows=await fetchMapIncidents(requireSupabase(),{signal:request.signal});
      if(mounted.current&&!request.signal.aborted){setReports(rows);setLastUpdated(new Date());}
    } catch(cause) {
      // Clear cached rows on read failures; do not display inaccessible/stale data
      // as a successful current snapshot after permission or connection failures.
      if(mounted.current&&!request.signal.aborted){setReports([]);setError('Unable to load real incidents: '+cause.message);}
    } finally {
      if(mounted.current&&!request.signal.aborted)setLoading(false);
    }
  },[]);
  useEffect(()=>{
    mounted.current=true;
    refresh();
    let stop=()=>{};
    try {stop=observeIncidentChanges(requireSupabase(),refresh,setRealtimeStatus);}
    catch {setRealtimeStatus('fallback');}
    // Always keep backup refresh: a joined channel does not prove publication is
    // configured or events are being delivered. Skip hidden tabs, refresh on return.
    const poll=setInterval(()=>{if(document.visibilityState!=='hidden')refresh();},30000);
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    document.addEventListener('visibilitychange',visible);
    window.addEventListener('online',visible);
    return ()=>{mounted.current=false;controller.current?.abort();stop();clearInterval(poll);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);};
  },[refresh]);
  return {reports,total:reports.length,loading,error,refresh,realtimeStatus,lastUpdated};
}
