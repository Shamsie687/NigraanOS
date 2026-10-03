import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('./voice-browser/fixture.jsx',import.meta.url));
const service=fileURLToPath(new URL('./voice-browser/service.js',import.meta.url));
const server=await createServer({configFile:false,cacheDir:'review/voice-browser-cache',plugins:[{
  name:'isolated-transcription-ui-test',enforce:'pre',
  resolveId(source){if(source.endsWith('/services/transcription'))return service;if(source==='/voice-fixture.jsx')return fixture;},
  configureServer(server){server.middlewares.use((req,res,next)=>{
    if(req.url!=='/')return next();
    server.transformIndexHtml('/',`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NigraanOS Transcription UI Test</title></head><body><div id="root"></div><script type="module" src="/voice-fixture.jsx"></script></body></html>`).then(html=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
  });},
},react()],server:{host:'127.0.0.1',port:5181,strictPort:true}});
await server.listen();server.printUrls();
