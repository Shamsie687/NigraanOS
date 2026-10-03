// Isolated browser test only. Production Vite/auth/config are never altered.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const local=name=>fileURLToPath(new URL('./command-browser/'+name,import.meta.url));
const server=await createServer({configFile:false,cacheDir:'review/command-browser-cache',plugins:[{
  name:'isolated-command-test',enforce:'pre',resolveId(source){
    if(source.endsWith('/hooks/useOperationalIncidents')||source.endsWith('/hooks/useReports'))return local('feed.js');
    if(source.endsWith('/hooks/useCityContext'))return local('environment.js');
    if(source==='./supabase'||/\/services\/supabase(?:\.js)?$/.test(source))return local('client.js');
    if(source.endsWith('/services/commandActivity'))return local('activity.js');
    if(source==='/command-fixture.jsx')return local('fixture.jsx');
  },configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url!=='/'&&!req.url.startsWith('/?'))return next();server.transformIndexHtml('/',`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NigraanOS · Local UI fixture only</title></head><body><div id="root"></div><script type="module" src="/command-fixture.jsx"></script></body></html>`).then(html=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});});}
},react()],server:{host:'127.0.0.1',port:5182,strictPort:true}});
await server.listen();server.printUrls();
