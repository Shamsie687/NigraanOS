// Isolated UI fixture only. No production imports of test providers/auth.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('./ai-browser/fixture.jsx',import.meta.url));
const client=fileURLToPath(new URL('./ai-browser/client.js',import.meta.url));
const hook=fileURLToPath(new URL('./ai-browser/feed.js',import.meta.url));
const server=await createServer({configFile:false,cacheDir:'review/ai-browser-cache',plugins:[{
  name:'isolated-ai-browser-test',enforce:'pre',resolveId(source){
    if(source.endsWith('/hooks/useOperationalIncidents'))return hook;
    if(source==='./supabase'||source.endsWith('/services/supabase')||source.endsWith('/services/supabase.js'))return client;
    if(source==='/ai-fixture.jsx')return fixture;
  },configureServer(server){server.middlewares.use((req,res,next)=>{
    if(req.url!=='/')return next();server.transformIndexHtml('/',`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nigraan AI · Automated Test Fixture</title></head><body><div id="root"></div><script type="module" src="/ai-fixture.jsx"></script></body></html>`).then(html=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
  });}},react()],server:{host:'127.0.0.1',port:5182,strictPort:true}});
await server.listen();server.printUrls();
