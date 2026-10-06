import {useEffect,useRef,useState} from 'react';
import {AgentError} from '../services/agentTools';
import {getSimulatorSession,configuredSimulator} from '../services/mcpSimulatorRuntime';
import {requireSupabase} from '../services/supabase';
import {planAgentMessage,boundedThread} from '../utils/agentConversation';
import {createInvestigationController} from '../services/incidentInvestigation';
export default function useNigraanAgent({accountId,onIncident,onView}){
  const [thread,setThread]=useState([]),[busy,setBusy]=useState(false),[tool,setTool]=useState('');
  const [connection,setConnection]=useState(()=>getSimulatorSession().snapshot());
  const [progress,setProgress]=useState(null);
  const current=useRef(null),controller=useRef(null),version=useRef(0),sequence=useRef(0),busyRef=useRef(false);
  const callbacks=useRef({onIncident,onView});callbacks.current={onIncident,onView};
  const investigation=useRef(null);
  useEffect(()=>{
    const client=requireSupabase();
    const session=getSimulatorSession();void session.accountChanged(accountId);
    const tools=session.facade(view=>callbacks.current.onView(view));
    investigation.current=createInvestigationController({tools});
    const unsubscribe=session.subscribe(value=>{setConnection(value);if(value.status!=='connected'){version.current++;controller.current?.abort();setThread([]);setBusy(false);setProgress(null);busyRef.current=false;}});
    current.current=tools;setThread([]);setBusy(false);busyRef.current=false;
    const listener=client.auth.onAuthStateChange?.((_event,value)=>{if(value?.user?.id!==accountId){void session.disconnect();version.current++;controller.current?.abort();tools.clear();setThread([]);setBusy(false);setProgress(null);setTool('');busyRef.current=false;}});
    return()=>{version.current++;controller.current?.abort();listener?.data?.subscription?.unsubscribe();unsubscribe();tools.clear();current.current=null;};
  },[accountId]);
  const add=entry=>setThread(previous=>boundedThread(previous,{...entry,id:++sequence.current}));
  async function submit(message,explicit=null){
    if(busyRef.current||!current.current)return;
    if(typeof message!=='string'||!message.trim()||[...message].length>600)return;
    const tools=current.current,revision=++version.current;controller.current?.abort();const request=new AbortController();controller.current=request;
    busyRef.current=true;setBusy(true);setProgress(null);add({role:'operator',text:message.trim()});
    try{
      const plan=explicit||planAgentMessage(message,tools);
      if(plan.message){add({role:'agent',text:plan.message});return;}
      setTool(plan.investigation?'Investigation':plan.tool);
      const data=plan.investigation?await investigation.current.run({signal:request.signal,onProgress:(name,ref)=>{if(version.current===revision&&!request.signal.aborted){setTool(name);setProgress({stage:name,ref});}}}):null;
      const result=plan.investigation?{kind:'INVESTIGATION',headline:'Bounded incident investigation · '+data.status,snapshotAt:Date.parse(data.completedAt),investigation:data}:await tools.run(plan.tool,plan.input,request.signal);
      if(version.current===revision&&!request.signal.aborted)add({role:'agent',tool:plan.tool,result,referenceVersion:tools.referenceVersion()});
    }catch(error){
      if(version.current===revision&&!request.signal.aborted){
        if(error?.code==='access')setThread([]);
        add({role:'agent',error:true,text:error instanceof AgentError?error.message:'Read unavailable. Retry the request.'});
      }
    }finally{if(version.current===revision){busyRef.current=false;setBusy(false);setProgress(null);setTool('');}}
  }
  function clear(){version.current++;controller.current?.abort();current.current?.clear();setThread([]);setBusy(false);setProgress(null);setTool('');busyRef.current=false;}
  function cancel(){if(!busyRef.current||!progress)return;version.current++;controller.current?.abort();investigation.current?.cancel();setBusy(false);setProgress(null);setTool('');busyRef.current=false;add({role:'agent',text:'Investigation cancelled. Already-started reads may count toward limits.'});}
  function isReferenceCurrent(ref,referenceVersion){try{current.current.assertReference(ref,referenceVersion);return true;}catch{return false;}}
  async function connect(){try{const session=getSimulatorSession(),url=await session.begin(configuredSimulator(),accountId);window.location.assign(url);}catch(e){setConnection({status:'failed',error:e instanceof AgentError?e.message:'MCP configuration or authorization failed.'});}}
  async function disconnect(){clear();await getSimulatorSession().disconnect();}
  return {thread,busy,tool,submit,clear,connection,connect,disconnect,progress,cancel,isReferenceCurrent};
}
