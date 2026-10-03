import {useEffect,useMemo,useState} from 'react';
import {fetchAnalyticsActivity} from '../services/analyticsActivity';
import {requireSupabase} from '../services/supabase';
export default function useAnalyticsActivity({incidents,from,to,accountId,enabled}){
  const [state,setState]=useState({rows:null,status:'loading',key:null});
  // Include source identity so rows from a previous feed/account/window never render.
  const key=useMemo(()=>({}),[incidents]);
  useEffect(()=>{
    const controller=new AbortController();const identity={key,from,to,accountId};setState({...identity,rows:null,status:enabled?'loading':'unavailable'});
    if(enabled)Promise.resolve().then(()=>fetchAnalyticsActivity(requireSupabase(),{incidentIds:incidents.filter(i=>i.submission_state==='submitted').map(i=>i.id),from,to,signal:controller.signal})).then(rows=>{if(!controller.signal.aborted)setState({...identity,rows,status:'ready'});}).catch(()=>{if(!controller.signal.aborted)setState({...identity,rows:null,status:'unavailable'});});
    return()=>controller.abort();
  },[key,from,to,accountId,enabled]);
  return enabled&&state.key===key&&state.from===from&&state.to===to&&state.accountId===accountId?state:{rows:null,status:enabled?'loading':'unavailable'};
}
