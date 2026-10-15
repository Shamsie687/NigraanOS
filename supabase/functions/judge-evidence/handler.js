const TYPES=new Set(['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4']);
export function createJudgeEvidenceHandler({userClient,download,allowedOrigins}) {
  return async request=>{
    const origin=request.headers.get('Origin'),allowed=allowedOrigins().split(',').map(x=>x.trim()).filter(Boolean);
    const headers={'Cache-Control':'no-store, private','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if(origin&&allowed.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'});
    const reply=(status,message)=>new Response(JSON.stringify({error:message}),{status,headers:{...headers,'Content-Type':'application/json'}});
    try{
      if(origin&&!allowed.includes(origin))return reply(403,'Origin unavailable');
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(request.method!=='POST')return reply(405,'POST required');
      if(!/^Bearer \S+$/.test(request.headers.get('Authorization')||''))return reply(401,'Sign in required');
      if(Number(request.headers.get('Content-Length'))>256)return reply(413,'Request too large');
      const reader=request.body?.getReader();if(!reader)return reply(400,'Invalid request');
      let raw='',count=0;const decoder=new TextDecoder();
      try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>256)return reply(413,'Request too large');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel();}
      const input=JSON.parse(raw);
      if(Object.keys(input).length!==1||typeof input.evidence_id!=='string'||!/^[0-9a-f-]{36}$/i.test(input.evidence_id))return reply(400,'Invalid evidence request');
      const client=userClient(request.headers.get('Authorization'));
      const identity=await client.auth.getUser();if(identity.error||!identity.data?.user)return reply(401,'Sign in required');
      async function authorize(){const r=await client.rpc('nigraan_operations_access_context');if(r.error||r.data?.allowed!==true||(r.data.permanent!==true&&r.data.status!=='active'))throw new Error('access');}
      await authorize();
      // Caller JWT/RLS selects the exact evidence. No caller-supplied bucket/path.
      const result=await client.from('evidence').select('id,incident_id,uploader_id,storage_path,mime_type,file_size').eq('id',input.evidence_id).maybeSingle();
      if(result.error||!result.data)return reply(403,'Evidence unavailable');
      const row=result.data,parts=row.storage_path.split('/');
      if(![3,4].includes(parts.length)||parts.some(p=>!p||p==='.'||p==='..')||parts[0]!==row.uploader_id||parts[1]!==row.incident_id||!TYPES.has(row.mime_type)||!Number.isInteger(row.file_size)||row.file_size<1||row.file_size>10485760)return reply(403,'Evidence unavailable');
      await authorize();
      const bytes=await download(row.storage_path,row.file_size);
      if(bytes.byteLength!==row.file_size)return reply(503,'Evidence unavailable');
      await authorize();
      return new Response(bytes,{status:200,headers:{...headers,'Content-Type':'application/octet-stream'}});
    }catch{return reply(403,'Unable to confirm current evidence access');}
  };
}
