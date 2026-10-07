import {useEffect,useRef,useState} from 'react';
import {requireSupabase} from '../services/supabase';
import {readAroundMe} from '../services/aroundMe';
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export default function useAroundMe(userId,query){
  const [state,setState]=useState({}),refreshRef=useRef(()=>{});
  useEffect(()=>{
    let active=true,pending=false,controller,lastDay=null,denied=false,limited=false;
    const client=requireSupabase();
    async function refresh(manual=false){
      if(!active||pending||denied||document.hidden||(!manual&&(limited||lastDay===day())))return;
      pending=true;controller=new AbortController();setState(old=>({...old,userId,row:query.row,column:query.column,loading:true,error:''}));
      try{const data=await readAroundMe(client,query,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(active){lastDay=day();limited=false;setState({userId,row:query.row,column:query.column,data,loading:false,error:''});}}
      catch(error){if(active&&!controller.signal.aborted){denied=['PT403','PGRST301','PGRST302'].includes(error.code);limited=error.code==='PT429';setState(old=>({...old,loading:false,error:limited?'Around Me request limit reached. Wait before refreshing again.':denied?'Sign in again to view Around Me.':'Around Me could not be refreshed. Any displayed groups are from the last successful snapshot.'}));}}
      finally{pending=false;}
    }
    setState({userId,row:query.row,column:query.column,loading:true});refreshRef.current=()=>refresh(true);void refresh();
    const visibility=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visibility);
    // Daily data does not need one RPC each minute. Check rollover while visible.
    const interval=setInterval(visibility,60000);
    const {data:auth}=client.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==userId){active=false;controller?.abort();setState({userId,row:query.row,column:query.column,error:'Sign in again to view Around Me.'});}});
    return()=>{active=false;controller?.abort();clearInterval(interval);auth.subscription.unsubscribe();document.removeEventListener('visibilitychange',visibility);refreshRef.current=()=>{};};
  },[userId,query.row,query.column]);
  return {...(state.userId===userId&&state.row===query.row&&state.column===query.column?state:{loading:true}),refresh:()=>refreshRef.current()};
}
