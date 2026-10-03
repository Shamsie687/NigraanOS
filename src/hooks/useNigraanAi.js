import {useEffect,useRef,useState} from 'react';
import {requireSupabase} from '../services/supabase';
import {invokeNigraanAi} from '../services/nigraanAi';
export default function useNigraanAi() {
  const [result,setResult]=useState(null),[loading,setLoading]=useState(false);
  const controller=useRef(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
  async function generate(input){
    if(controller.current)return;
    const request=new AbortController();controller.current=request;setLoading(true);setResult(null);
    try{const data=await invokeNigraanAi(requireSupabase(),input,request.signal);if(alive.current&&!request.signal.aborted)setResult(data);}
    catch{if(alive.current&&!request.signal.aborted)setResult({error:{code:'connection',message:'Unable to connect to Nigraan AI.'}});}
    finally{controller.current=null;if(alive.current&&!request.signal.aborted)setLoading(false);}
  }
  return {result,loading,generate};
}
