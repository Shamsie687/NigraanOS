import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
export const SCOPE='https://www.googleapis.com/auth/gmail.send';
export function authorizationUrl(clientId,redirect,state,verifier){
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false',login_hint:'nigraanos.admin@gmail.com',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
  return url.href;
}
export function callbackCode(url,state){
  if(url.pathname!=='/oauth2callback'||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==state||url.searchParams.has('error')||url.searchParams.getAll('code').length!==1||!url.searchParams.get('code'))throw new Error('Authorization callback rejected');
  return url.searchParams.get('code');
}
function subprocess(args,input){return new Promise((resolveResult,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',args],{windowsHide:true,env:{...process.env,PSModulePath:join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules')},stdio:['pipe','pipe','ignore']});
  let result='';child.stdout.on('data',data=>result+=data);child.on('error',()=>reject(new Error('Private credential protection failed')));child.on('close',code=>code===0?resolveResult(result.trim()):reject(new Error('Private credential protection failed')));child.stdin.on('error',()=>{});child.stdin.end(input);
});}
export async function protectCredentials(value){
  const result=await subprocess("$s=[Console]::In.ReadToEnd(); ConvertTo-SecureString -String $s -AsPlainText -Force | ConvertFrom-SecureString",value);
  if(!/^[0-9a-f]+$/i.test(result)||result.length<100)throw new Error('Private credential protection failed');
  return result;
}
async function outsideRepository(path,mustExist){
  const repo=await realpath(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
  const actual=mustExist?await realpath(resolve(path)):resolve(await realpath(dirname(resolve(path))),resolve(path).split(/[\\/]/).pop());
  const rel=relative(repo,actual);if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw new Error('Use a private location outside the repository');
  return actual;
}
async function main(){
  if(process.platform!=='win32')throw new Error('This private authorization helper requires Windows DPAPI');
  const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--client'||args[2]!=='--output')throw new Error('Usage: node scripts/authorize-gmail.mjs --client PRIVATE_CLIENT_JSON --output PRIVATE_ENCRYPTED_JSON');
  const clientPath=await outsideRepository(args[1],true),output=await outsideRepository(args[3],false);
  try{await lstat(output);throw new Error('Choose a new private output filename');}catch(error){if(error.code!=='ENOENT')throw error;}
  const client=JSON.parse(await readFile(clientPath,'utf8')).installed;
  if(!client?.client_id||!client?.client_secret)throw new Error('A downloaded Desktop OAuth client JSON is required');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  let receive,abort;const codePromise=new Promise((r,j)=>{receive=r;abort=j;});
  const server=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'");res.setHeader('Referrer-Policy','no-referrer');
    try{
      if(req.method!=='GET'||req.headers.host!==new URL(redirect).host)throw new Error('Invalid callback');
      const code=callbackCode(new URL(req.url,redirect),state);
      if(used)throw new Error('Callback already consumed');used=true;
      res.end('Authorization received. Close this tab and return to PowerShell.');receive(code);
    }catch{res.statusCode=400;res.end('Authorization callback rejected. No credentials were saved.');}
  });
  let redirect,used=false;
  await new Promise((r,j)=>{server.once('error',()=>j(new Error('Local callback unavailable')));server.listen(0,'127.0.0.1',r);});
  redirect=`http://127.0.0.1:${server.address().port}/oauth2callback`;
  const timer=setTimeout(()=>abort(new Error('Authorization timed out; no credentials saved')),300000);
  try{
    console.log('A Google consent window will open. Select nigraanos.admin@gmail.com and approve send-only access. No email will be sent.');
    const url=authorizationUrl(client.client_id,redirect,state,verifier);
    // URL is passed through stdin, never logged or placed in shell command text.
    await subprocess("$u=[Console]::In.ReadToEnd(); Start-Process -FilePath $u -WindowStyle Hidden",url);
    const code=await codePromise;
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.client_id,client_secret:client.client_secret,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Google token exchange failed; no credentials saved');
    const token=await response.json();
    if(!token.refresh_token||token.scope!==SCOPE)throw new Error('Missing refresh token or unexpected scope; no credentials saved');
    // gmail.send cannot inspect mailbox identity. Account selection must be checked by the owner.
    const secrets=JSON.stringify({GMAIL_CLIENT_ID:client.client_id,GMAIL_CLIENT_SECRET:client.client_secret,GMAIL_REFRESH_TOKEN:token.refresh_token,JUDGE_EMAIL_FROM:'nigraanos.admin@gmail.com'});
    const encrypted=await protectCredentials(secrets);
    await writeFile(output,JSON.stringify({format:'windows-dpapi-current-user',credentials:encrypted},null,2),{flag:'wx',mode:0o600});
    console.log('Private encrypted credentials saved. Testing-mode authorization expires after seven days. No tokens were printed and no email was sent.');
  }finally{clearTimeout(timer);server.closeAllConnections();server.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Authorization did not complete. Check private paths, Desktop client configuration, account selection and Google consent. No secret details are logged.');process.exitCode=1;});
