import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

test('catalog, speed validation and login use isolated account profile',async()=>{
 const home=await mkdtemp(join(tmpdir(),'luna-account-test-'));
 try{
  const bin=join(home,'fake-service');
  await writeFile(bin,`#!${process.execPath}
import readline from 'node:readline';
const linked=!!process.env.CODEX_HOME;
for await(const line of readline.createInterface({input:process.stdin})){
 const q=JSON.parse(line);if(q.id===undefined)continue;let result={};
 if(q.method==='account/read')result={account:{type:'chatgpt',email:linked?'linked@example.test':'computer@example.test'}};
 if(q.method==='model/list')result={data:[{model:'test-model',displayName:'Test',supportedReasoningEfforts:[{reasoningEffort:'low'}],additionalSpeedTiers:['fast']},{model:'slow-model',displayName:'Slow',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}]};
 if(q.method==='account/login/start'){if(!linked)throw Error('Login must use private profile');result={loginId:'test-login',authUrl:'https://auth.openai.com/test'}};
 if(q.method==='account/login/cancel'&&(!linked||q.params.loginId!=='test-login'))throw Error('Invalid cancellation');
 process.stdout.write(JSON.stringify({id:q.id,result})+'\\n');
}
`,{mode:0o700});
  const script=`import assert from 'node:assert/strict';
import {catalog,resolveModel,startLogin,cancelLogin,closeAccount} from ${JSON.stringify(new URL('../host/account.mjs',import.meta.url).href)};
try{
 const state=await catalog();assert.equal(state.account.source,'computer');assert.equal(state.models.length,2);
 assert.deepEqual(await resolveModel('test-model','fast'),{model:'test-model',effort:'low',speed:'fast'});
 await assert.rejects(resolveModel('slow-model','fast'),/Fast/);
 await assert.rejects(resolveModel('missing','standard'),/unavailable/);
 await assert.rejects(resolveModel('test-model','turbo'),/speed/);
 assert.equal((await startLogin()).authUrl,'https://auth.openai.com/test');
 assert.equal((await catalog({refresh:true})).login.pending,true);
 await cancelLogin();assert.equal((await catalog({refresh:true})).login,null);
 assert.equal((await catalog()).account.source,'computer');
}finally{closeAccount()}`;
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script],{env:{...process.env,HOME:home,LUNA_CODEX_BIN:bin},stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);child.on('error',reject);child.on('exit',code=>resolve({code,out}))});
  assert.equal(result.code,0,result.out);
 }finally{await rm(home,{recursive:true,force:true})}
});
