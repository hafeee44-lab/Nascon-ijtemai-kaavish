import * as esbuild from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const dist=path.join(here,'.dist');const clients=new Set();
const context=await esbuild.context({entryPoints:[path.join(here,'entry.tsx')],bundle:true,outfile:path.join(dist,'bundle.js'),platform:'browser',resolveExtensions:['.web.tsx','.web.ts','.web.jsx','.web.js','.tsx','.ts','.jsx','.js','.json'],define:{__DEV__:'true','process.env.NODE_ENV':'"development"','global':'window'},alias:{'@react-native/assets-registry/registry':path.join(here,'node_modules/react-native-web/dist/modules/AssetRegistry/index.js'),'react-native':path.join(here,'native.tsx'),'react-native-safe-area-context':path.join(here,'safe.tsx'),'react-native-web':path.join(here,'node_modules/react-native-web'),'react':path.join(here,'node_modules/react'),'react-dom':path.join(here,'node_modules/react-dom')},loader:{'.jpg':'dataurl','.png':'dataurl'},plugins:[{name:'reload',setup(build){build.onEnd(result=>{if(!result.errors.length)for(const res of clients)res.write('event: reload\ndata: ready\n\n');});}}]});
await context.watch();
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
 if(url.pathname.startsWith('/backend/')){const proxy=http.request({hostname:'127.0.0.1',port:8080,path:req.url.slice('/backend'.length),method:req.method,headers:{...req.headers,host:'127.0.0.1:8080'}},upstream=>{res.writeHead(upstream.statusCode??502,upstream.headers);upstream.pipe(res);});proxy.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'BACKEND_UNAVAILABLE',message:'Local backend is starting. Try again shortly.'}}));});req.pipe(proxy);return;}
 const relative=url.pathname.startsWith('/fonts/')?path.join(here,'../android/app/src/main/assets/fonts',path.basename(url.pathname)):url.pathname==='/bundle.js'?path.join(dist,'bundle.js'):path.join(here,'index.html');
 try{const type=relative.endsWith('.ttf')?'font/ttf':relative.endsWith('.js')?'text/javascript':'text/html; charset=utf-8';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});fs.createReadStream(relative).pipe(res);}catch{res.writeHead(404);res.end('Not found');}
}).listen(4186,'0.0.0.0',()=>console.log('MATCHDAY READY → http://127.0.0.1:4186 (LAN: http://<your-ip>:4186)'));
