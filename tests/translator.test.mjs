import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateRequest,validateResult,cleanEnvironment} from '../host/translator.mjs';
test('bounds and validates untrusted requests',()=>{
 for(const data of [{},{target:'__proto__',segments:[{id:'1',text:'a'}]},{target:'ru',segments:[{id:'a',text:'abc'},{id:'a',text:'xyz'}]},{target:'ru',segments:[{id:'x',text:'x'.repeat(6001)}]}])assert.throws(()=>validateRequest(data));
 assert.deepEqual(validateRequest({target:'ru',segments:[{id:'x',text:'hello',injected:true}],url:'private'}),{target:'Russian',segments:[{id:'x',text:'hello'}]});
});
test('requires all IDs exactly once and unchanged inline structure',()=>{
 const req={segments:[{id:'x',text:'See <0>here</0>'}]};
 assert.throws(()=>validateResult('{"segments":[]}',req));
 assert.throws(()=>validateResult('{"segments":[{"id":"x","text":"Ссылка"}]}',req));
 assert.deepEqual(validateResult('{"segments":[{"id":"x","text":"См. <0>здесь</0>"}]}',req).segments[0].id,'x');
});
test('does not inherit API keys or parent task credentials',()=>{
 process.env.OPENAI_API_KEY='test-only';process.env.CODEX_THREAD_ID='test-only';process.env.CODEX_HOME='test-only';
 const env=cleanEnvironment();assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.CODEX_THREAD_ID,undefined);assert.equal(env.CODEX_HOME,undefined);
 delete process.env.OPENAI_API_KEY;delete process.env.CODEX_THREAD_ID;delete process.env.CODEX_HOME;
});

const { consumeResponse, translate } = await import('../host/translator.mjs');
function stream(events, crlf = false) {
 const bytes = new TextEncoder().encode(events.map(e => 'data: '+JSON.stringify(e)+'\n\n').join('').replaceAll('\n', crlf ? '\r\n' : '\n'));
 return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close()}}));
}
test('requires completed SSE and rejects late usage errors, truncation and HTTP failures',async()=>{
 const delta={type:'response.output_text.delta',delta:'Привет'};
 assert.equal((await consumeResponse(stream([delta,{type:'response.completed',response:{status:'completed'}}],true))).text,'Привет');
 await assert.rejects(consumeResponse(stream([delta])),/before/);
 await assert.rejects(consumeResponse(stream([delta,{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/Manage usage/);
 await assert.rejects(consumeResponse(stream([{type:'response.incomplete'}])),/did not complete/);
 await assert.rejects(consumeResponse(new Response('',{status:429})),/usage limit/);
});
test('translation calls public Responses with scoped OAuth and validates completed output',async()=>{
 const account={resolveModel:async()=>({model:'test-model',speed:'standard',profileId:'profile'}),access:async id=>{assert.equal(id,'profile');return {token:'fake-token'}}};
 const result=await translate({target:'ru',segments:[{id:'a',text:'Hi <0>world</0>'}]},{account,fetchImpl:async(url,opts)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(opts.headers.Authorization,'Bearer fake-token');
  const body=JSON.parse(opts.body);assert.equal(body.store,false);assert.equal(body.stream,true);assert.ok(Array.isArray(body.input));assert.equal(body.tools,undefined);assert.equal(body.text.format.strict,true);
  return stream([{type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({segments:[{id:'a',text:'Привет <0>мир</0>'}]})}]}]}}]);
 }});
 assert.equal(result.segments[0].text,'Привет <0>мир</0>');
 const c=new AbortController();c.abort();await assert.rejects(translate({target:'ru',segments:[{id:'a',text:'Hi'}]},{account,signal:c.signal,fetchImpl:async(_,o)=>{o.signal.throwIfAborted()}}),/Cancelled/);
});
