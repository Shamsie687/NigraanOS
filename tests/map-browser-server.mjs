// Isolated visual test server: browser fixture only; never production auth bypass.
// node tests/map-browser-server.mjs -> http://127.0.0.1:5180/
// Aliases exist solely in this separate server, not the application Vite config.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('./map-browser/fixture.jsx',import.meta.url));
const client=fileURLToPath(new URL('./map-browser/client.js',import.meta.url));
const hook=fileURLToPath(new URL('./map-browser/feed.js',import.meta.url));
const server=await createServer({configFile:false,cacheDir:'review/map-browser-cache',plugins:[{
  name:'isolated-map-test-fixture',enforce:'pre',
  resolveId(source){
    if(source.endsWith('/hooks/useOperationalIncidents'))return hook;
    if(source==='./supabase'||source.endsWith('/services/supabase')||source.endsWith('/services/supabase.js'))return client;
    if(source==='/map-fixture.jsx')return fixture;
  },
  configureServer(server){server.middlewares.use((req,res,next)=>{
    if(req.url!=='/')return next();
    server.transformIndexHtml('/',`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NigraanOS Map Fixture · Local Test Only</title></head><body><div id="root"></div><script type="module" src="/map-fixture.jsx"></script></body></html>`).then(html=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
  });},
},react()],server:{host:'127.0.0.1',port:5180,strictPort:true}});
await server.listen();server.printUrls();
