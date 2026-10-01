import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

test('MCP discovers tools, translates text, rejects invalid inputs, and survives malformed JSON',async()=>{
 const home=await mkdtemp(join(tmpdir(),'lunori-mcp-'));
 let child;
 try{
 const accountDir=join(home,'Library/Application Support/Lunori/ChatGPT');
 await mkdir(accountDir,{recursive:true});
 await writeFile(join(accountDir,'connections.json'),JSON.stringify({hostId:'urn:uuid:test',active:'test-client',profiles:{'test-client':{clientId:'test-client',subject:'test',email:'reader@example.test',accessToken:'fake-test-only',expiresAt:Date.now()+3600000,scopes:['resource.invoke','chatgpt.tokens.use.direct']}}}));
 const mock=join(home,'mock.mjs');
 await writeFile(mock,`globalThis.fetch=async(url,options)=>{
 if(url==='https://api.openai.com/v1/models')return Response.json({models:[{slug:'test-luna',display_name:'Test',visibility:'list'}]});
 if(url!=='https://api.openai.com/v1/responses')throw Error('Unexpected endpoint');
 const input=JSON.parse(JSON.parse(options.body).input[0].content);
 const event={type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({segments:input.segments.map(s=>({id:s.id,text:'Translated '+s.text}))})}]}]}};
 return new Response('data: '+JSON.stringify(event)+'\\n\\n');
 };`);
 child=spawn(process.execPath,['--import',mock,'host/mcp.mjs'],{env:{...process.env,HOME:home},stdio:['pipe','pipe','pipe']});
 const waiting=new Map();let seq=0;
 createInterface({input:child.stdout}).on('line',line=>{const msg=JSON.parse(line);waiting.get(msg.id)?.(msg);waiting.delete(msg.id)});
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error('RPC timed out')),8000);waiting.set(id,r=>{clearTimeout(timer);resolve(r)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 assert.equal((await call('initialize',{})).result.serverInfo.name,'lunori');
 assert.equal((await call('tools/list',{})).result.tools.length,5);
 const translated=(await call('tools/call',{name:'translate_text',arguments:{text:'Hello <0>world</0>',target:'en',model:'test-luna'}})).result;
 assert.equal(JSON.parse(translated.content[0].text).text,'Translated Hello <0>world</0>');
 assert.equal((await call('tools/call',{name:'translate_text',arguments:{text:'Hi',target:'invalid'}})).result.isError,true);
 assert.equal((await call('tools/call',{name:'missing'})).result.isError,true);
 child.stdin.write('broken JSON\n');
 assert.deepEqual((await call('ping',{})).result,{});
 }finally{child?.kill('SIGTERM');if(child)await new Promise(r=>child.once('exit',r));await rm(home,{recursive:true,force:true})}
});
