import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

test('MCP discovers tools, translates text, rejects invalid inputs, and survives malformed JSON',async()=>{
 const home=await mkdtemp(join(tmpdir(),'lunori-mcp-'));
 let child;
 try{
 const binary=join(home,'runtime');
 await writeFile(binary,`#!${process.execPath}
import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){
 const q=JSON.parse(line);let result={};
 if(process.argv[2]==='exec'){console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({segments:q.segments.map(s=>({id:s.id,text:'Translated '+s.text}))})}}));process.exit(0)}
 if(q.id===undefined)continue;
 if(q.method==='account/read')result={account:{type:'chatgpt',email:'reader@example.test'}};
 if(q.method==='model/list')result={data:[{model:'test-model',displayName:'Test',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
 console.log(JSON.stringify({id:q.id,result}));
}`,{mode:0o700});
 child=spawn(process.execPath,['host/mcp.mjs'],{env:{...process.env,HOME:home,LUNA_CODEX_BIN:binary},stdio:['pipe','pipe','pipe']});
 const waiting=new Map();let seq=0;
 createInterface({input:child.stdout}).on('line',line=>{const msg=JSON.parse(line);waiting.get(msg.id)?.(msg);waiting.delete(msg.id)});
 const call=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error('RPC timed out')),8000);waiting.set(id,r=>{clearTimeout(timer);resolve(r)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 assert.equal((await call('initialize',{})).result.serverInfo.name,'lunori');
 assert.equal((await call('tools/list',{})).result.tools.length,5);
 const translated=(await call('tools/call',{name:'translate_text',arguments:{text:'Hello <0>world</0>',target:'en',model:'test-model'}})).result;
 assert.equal(JSON.parse(translated.content[0].text).text,'Translated Hello <0>world</0>');
 assert.equal((await call('tools/call',{name:'translate_text',arguments:{text:'Hi',target:'invalid'}})).result.isError,true);
 assert.equal((await call('tools/call',{name:'missing'})).result.isError,true);
 child.stdin.write('broken JSON\n');
 assert.deepEqual((await call('ping',{})).result,{});
 }finally{child?.kill('SIGTERM');if(child)await new Promise(r=>child.once('exit',r));await rm(home,{recursive:true,force:true})}
});
