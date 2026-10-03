import {useCallback,useEffect,useRef,useState} from 'react';
import {requireSupabase} from '../services/supabase';
import {loadCityContext} from '../services/cityContext';
import {displayEnvironment} from '../utils/cityEnvironment';
export default function useCityContext(cityId,enabled){
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[clock,setClock]=useState(Date.now());
  const active=useRef(false),controller=useRef(null);
  const refresh=useCallback(async()=>{
    if(!active.current)return;controller.current?.abort();const request=new AbortController();controller.current=request;
    setLoading(true);setError('');
    try{const value=await loadCityContext(requireSupabase(),cityId,request.signal);if(active.current&&!request.signal.aborted){setData(value);setClock(Date.now());}}
    catch{if(active.current&&!request.signal.aborted){setError('Environmental data unavailable.');setClock(Date.now());}}
    finally{if(active.current&&!request.signal.aborted)setLoading(false);}
  },[cityId]);
  useEffect(()=>{setData(null);setError('');},[cityId]);
  useEffect(()=>{
    active.current=enabled;if(!enabled)return;
    refresh();const interval=setInterval(()=>{setClock(Date.now());if(document.visibilityState==='visible'&&navigator.onLine)refresh();},60000);
    const visible=()=>{setClock(Date.now());if(document.visibilityState==='visible')refresh();};
    document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);
    return()=>{active.current=false;controller.current?.abort();clearInterval(interval);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);};
  },[enabled,refresh]);
  return {data:displayEnvironment(data,clock,Boolean(error)),loading,error,refresh};
}
