export async function readAccountability(client,incident,{signal}={}) {
  let q=client.rpc('nigraan_read_accountability',{incident});if(signal)q=q.abortSignal(signal);
  const {data,error}=await q;if(error)throw error;return data;
}
export async function publishOperationsUpdate(client,{incident,body,requestId,resolution=false,expectedStatus}) {
  const message=body.trim();if(!message||message.length>1000)throw new Error('Enter a message up to 1000 characters.');
  const {data,error}=await client.rpc(resolution?'nigraan_resolve_with_message':'nigraan_publish_public_update',{
    incident,body:message,request_id:requestId,...(resolution?{expected_status:expectedStatus}:{}),
  });if(error)throw error;return data;
}
export function watchAccountability({load,onData,onError,visible=()=>true,schedule=setTimeout,cancel=clearTimeout,now=Date.now}) {
  let active=true,pending=false,timer=null,controller=null,failures=0,stopped=false;
  function queue(){if(!active||stopped)return;timer=schedule(()=>{timer=null;void refresh();},Math.min(120000,30000*2**failures));}
  async function refresh(){
    if(!active||stopped||pending||!visible())return;
    if(timer!==null){cancel(timer);timer=null;}pending=true;controller=new AbortController();
    try{const data=await load(AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]));if(active){failures=0;onData(data,now());}}
    catch(error){if(active&&!controller.signal.aborted){failures=Math.min(2,failures+1);stopped=['PT403','PGRST301','PGRST302'].includes(error.code);onError(error);}}
    finally{pending=false;if(active)queue();}
  }
  function visibilityChanged(){if(timer!==null){cancel(timer);timer=null;}if(visible())void refresh();}
  void refresh();return {refresh,visibilityChanged,close(){active=false;if(timer!==null)cancel(timer);controller?.abort();}};
}
