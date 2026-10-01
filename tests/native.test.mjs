import{test}from'node:test';import assert from'node:assert/strict';import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';
test('native messaging supports fragmented and multiple frames',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('../host/native.mjs',import.meta.url))]);
 const pack=value=>{const b=Buffer.from(JSON.stringify(value)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);return Buffer.concat([h,b]);};
 const a=pack({type:'ping',id:'one'}),b=pack({type:'ping',id:'two'});let buffer=Buffer.alloc(0);const replies=[];
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout')),3000);child.on('error',reject);child.stdout.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=buffer.readUInt32LE()+4){const length=buffer.readUInt32LE();replies.push(JSON.parse(buffer.subarray(4,4+length)));buffer=buffer.subarray(4+length);}if(replies.length===2){clearTimeout(timer);resolve();}});child.stdin.write(a.subarray(0,2));child.stdin.write(Buffer.concat([a.subarray(2),b]));});assert.deepEqual(replies.map(r=>[r.id,r.model]),[['one','gpt-6-luna'],['two','gpt-6-luna']]);}finally{child.kill();}
});
