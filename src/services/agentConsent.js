import {mcpDeploymentConfig} from './mcpDeploymentConfig.js';
export function consentServer(){
  const value=import.meta.env.VITE_NIGRAAN_MCP_URL||(import.meta.env.DEV?'http://127.0.0.1:8787':'');
  const callback=import.meta.env.VITE_NIGRAAN_MCP_REDIRECT_URI||((typeof window!=='undefined'&&window.sessionStorage.getItem('nigraan.mcp.pkce.v1'))?window.location.origin+'/agent-callback':undefined);
  return mcpDeploymentConfig(value,callback).endpoint;
}
export async function consentRequest(client,path,{transaction,state,decision,signal}){
  if(!/^[A-Za-z0-9_-]{43}$/.test(transaction))throw new Error('Authorization request is invalid or expired.');
  const session=await client.auth.getSession();const token=session.data?.session?.access_token;
  if(!token)throw new Error('Sign in before approving access.');
  const server=consentServer();const result=await fetch(server+path+(decision?'':'?transaction='+encodeURIComponent(transaction)),{method:decision?'POST':'GET',headers:{Authorization:'Bearer '+token,...(decision?{'Content-Type':'application/json'}:{})},body:decision?JSON.stringify({transaction,state,decision}):undefined,signal,credentials:'omit',cache:'no-store',redirect:'error'});
  if(!result.ok)throw new Error('Authorization request is unavailable, expired, or not permitted.');
  const data=await result.json();
  if(decision){const target=new URL(data.redirect);const callback=import.meta.env.VITE_NIGRAAN_MCP_REDIRECT_URI||((typeof window!=='undefined'&&window.sessionStorage.getItem('nigraan.mcp.pkce.v1'))?window.location.origin+'/agent-callback':undefined);const expected=new URL(mcpDeploymentConfig(server,callback).redirect);if(target.origin!==expected.origin||target.pathname!==expected.pathname||target.hash||target.username||target.password||target.searchParams.get('state')!==state||target.searchParams.getAll('state').length!==1||[...target.searchParams.keys()].some(k=>!['code','state','error'].includes(k)))throw new Error('Authorization callback was rejected.');return {redirect:target.href};}
  if(typeof data.clientName!=='string'||data.clientName.length>100||data.scope!=='nigraan:read'||!Array.isArray(data.capabilities)||data.capabilities.length!==5||data.capabilities.some(v=>typeof v!=='string'||v.length>100)||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now()||!/^[A-Za-z0-9_-]{22,128}$/.test(data.state))throw new Error('Authorization request was rejected.');
  return data;
}
