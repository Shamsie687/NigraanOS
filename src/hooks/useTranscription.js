import {useEffect,useReducer,useRef} from 'react';
import {transcribeEvidence} from '../services/transcription';
import {emptyTranscript,transcriptReducer} from '../utils/transcriptState.js';
export default function useTranscription(audio) {
  const [state,dispatch]=useReducer(transcriptReducer,undefined,emptyTranscript);
  const generation=useRef(0);
  const pending=useRef(null);
  useEffect(()=>{
    generation.current++;
    pending.current?.abort();
    dispatch({type:'reset'});
    return ()=>{generation.current++;pending.current?.abort();};
  },[audio]);
  function change(action) {
    generation.current++;
    pending.current?.abort();
    dispatch(action);
  }
  async function transcribe() {
    if (!audio || state.status==='loading') return;
    const version=++generation.current;
    pending.current?.abort();
    const controller=new AbortController();pending.current=controller;
    dispatch({type:'start'});
    try {
      const result=await transcribeEvidence(audio,state.selectedLanguage,controller.signal);
      if (version===generation.current) dispatch({type:'success',result});
    } catch (cause) {
      if (version===generation.current) dispatch({type:'failure',message:cause.message});
    }
  }
  return {state,dispatch,transcribe,skip:()=>change({type:'skip'}),language:value=>change({type:'language',value})};
}
