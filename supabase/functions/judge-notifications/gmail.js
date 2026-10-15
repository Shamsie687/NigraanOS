const SENDER='nigraanos.admin@gmail.com';
const fail=code=>Object.assign(new Error('Email unavailable'),{safeCode:code});
export function gmailRaw(message,jobId){
  if(message.from!==SENDER || message.to.length!==1 || !/^[^\s<>@]+@[^\s<>@]+$/.test(message.to[0]) || /[\r\n]/.test(message.subject))throw fail('configuration');
  const body=new TextEncoder().encode(message.text);
  const base64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
  const mime=`From: NigraanOS <${SENDER}>\r\nTo: ${message.to[0]}\r\nSubject: ${message.subject}\r\nMessage-ID: <nigraan-judge-${jobId}@gmail.com>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(body)}\r\n`;
  return base64(new TextEncoder().encode(mime)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function sendGmail(message,jobId,settings,fetcher=fetch){
  if(!settings.clientId||!settings.clientSecret||!settings.refreshToken)throw fail('configuration');
  const raw=gmailRaw(message,jobId);
  let token;
  try{
    const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:settings.clientId,client_secret:settings.clientSecret,refresh_token:settings.refreshToken,grant_type:'refresh_token'}).toString(),signal:AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();throw fail('provider_failure');}
    token=await response.json();
    if(typeof token.access_token!=='string'||!token.access_token)throw fail('provider_failure');
    if(token.scope && token.scope!=='https://www.googleapis.com/auth/gmail.send')throw fail('configuration');
  }catch(error){throw fail(error.safeCode||'provider_failure');} // No send attempted: safe admin retry.
  try{
    const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();throw fail([400,401,403,404,429].includes(response.status)?'provider_failure':'delivery_unknown');}
    const result=await response.json();
    if(typeof result.id!=='string'||!result.id)throw fail('delivery_unknown');
    return result.id;
  }catch(error){throw fail(error.safeCode||'delivery_unknown');}
}
