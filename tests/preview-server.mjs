import {catalog,startLogin,cancelLogin,closeAccount} from '../host/account.mjs';
import http from 'node:http';import{readFile}from'node:fs/promises';import{fileURLToPath}from'node:url';import{translate}from'../host/translator.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));const port=43127;const active=new Set();
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end();}
  const path=new URL(req.url,`http://127.0.0.1:${port}`).pathname;
  if(path==='/control'&&req.method==='POST'){
    if(req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json'){res.writeHead(403);return res.end();}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413);return res.end();}}
    try{const message=JSON.parse(body);let output;if(message.type==='catalog')output=await catalog({refresh:!!message.refresh});else if(message.type==='login')output=await startLogin({newProfile:!!message.newProfile});else if(message.type==='loginCancel')output=await cancelLogin();else throw new Error('Unknown control');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(output));}catch(e){res.end(JSON.stringify({error:e.message}));}return;
  }
  if(path==='/translate'&&req.method==='POST'){
    if(req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json'){res.writeHead(403);return res.end();}
    if(active.size>=3){res.writeHead(429);return res.end('{"error":"Busy"}');}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>65536){res.writeHead(413);return res.end();}}
    const controller=new AbortController();active.add(controller);
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{const output=await translate(JSON.parse(body),{signal:controller.signal});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(output));}catch(e){res.end(JSON.stringify({error:e.message}));}finally{active.delete(controller);}return;
  }
  const routes={'/':'tests/preview.html','/popup':'extension/popup.html','/popup.css':'extension/popup.css','/popup.js':'extension/popup.js','/content.js':'extension/content.js','/bridge.js':'tests/preview-bridge.js'};
  const file=routes[path];if(!file){res.writeHead(404);return res.end();}
  try{let data=await readFile(root+file);if(path==='/popup')data=Buffer.from(data.toString().replace('<script src="popup.js">','<script src="bridge.js"></script><script src="popup.js">'));
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(data);
  }catch{res.writeHead(500);res.end('Preview unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Preview: http://127.0.0.1:${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const controller of active)controller.abort();closeAccount();server.close();process.exit(0);});
