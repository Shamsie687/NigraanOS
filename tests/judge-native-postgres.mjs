// Synthetic local Docker PostgreSQL. No ports, host mounts, hosted URLs or deletion.
import {execFileSync,execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
export async function createNativeJudgeDatabase(){
 const name='nigraan-judge-security-'+randomBytes(5).toString('hex');
 const image='postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3';
 const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']});
 docker(['run','-d','--name',name,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
 let role='',actor='';
 const execute=text=>docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],
   `set request.jwt.claim.sub=${quote(actor)};${role?'set role '+role+';':''}\n`+text);
 for(let n=0;n<30;n++){try{execute('select 1;');break;}catch{if(n===29){docker(['stop',name]);throw new Error('Native local PostgreSQL unavailable');}await new Promise(r=>setTimeout(r,250));}}
 return {
   async exec(text){if(text==='reset role'){role='';return;}if(text.startsWith('set role ')){role=text.slice(9);return;}execute(text);},
   async query(text,params=[]){
     if(text.startsWith("select set_config('request.jwt.claim.sub'")){actor=params[0];return {rows:[]};}
     const rendered=text.replace(/\$(\d+)/g,(_,i)=>params[Number(i)-1]===null?'null':quote(params[Number(i)-1])).replace(/;\s*$/,'');
     const statement=rendered.replace(/^\s*(?:--[^\n]*(?:\n|$)\s*)*/, '');
     const keywords=statement.replace(/'(?:''|[^'])*'/g,"''").replace(/--[^\n]*/g,'');
     if(/^\s*(select|with)\b/i.test(statement)&&!/^\s*with\b[\s\S]*\b(update|insert|delete)\b/i.test(keywords))return {rows:JSON.parse(execute("select coalesce(json_agg(x),'[]'::json) from ("+rendered+') x;'))};
     execute(rendered+';');return {rows:[]};
   },
   concurrentQuery(text,params=[]){
     const rendered=text.replace(/\$(\d+)/g,(_,i)=>quote(params[Number(i)-1]));
     return new Promise((resolve,reject)=>{
       const child=execFile('docker',['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],{encoding:'utf8',timeout:30000},(error,stdout)=>error?reject(error):resolve(stdout));
       child.stdin.end(`set request.jwt.claim.sub=${quote(actor)};${role?'set role '+role+';':''}\n`+rendered+';');
     });
   },
   async close(){docker(['stop',name]);console.log('Synthetic native PostgreSQL container stopped and retained; nothing removed.');}
 };
}
