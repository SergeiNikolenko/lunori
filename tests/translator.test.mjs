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
