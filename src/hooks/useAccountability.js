import {useEffect,useRef,useState} from 'react';
import {requireSupabase} from '../services/supabase';
import {readAccountability,watchAccountability} from '../services/accountability';
export default function useAccountability(incident,userId) {
  const [state,setState]=useState({});const watcher=useRef(null);
  useEffect(()=>{
    setState({});if(!userId)return;
    const client=requireSupabase();
    const w=watchAccountability({load:signal=>readAccountability(client,incident,{signal}),visible:()=>!document.hidden,
      onData:(data,updatedAt)=>setState({incident,userId,data,updatedAt,error:''}),onError:()=>setState(old=>({...old,incident,userId,error:'Progress could not be refreshed. Showing the last successful read.'}))});
    watcher.current=w;document.addEventListener('visibilitychange',w.visibilityChanged);
    const {data:auth}=client.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==userId){w.close();setState({incident,userId,error:'Sign in again to view your report progress.'});}});
    return()=>{w.close();watcher.current=null;auth.subscription.unsubscribe();document.removeEventListener('visibilitychange',w.visibilityChanged);};
  },[incident,userId]);
  return {...(state.incident===incident&&state.userId===userId?state:{}),refresh:()=>watcher.current?.refresh()};
}
