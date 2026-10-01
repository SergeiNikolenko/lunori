import { readFile } from 'node:fs/promises';
import { resolveModel, access } from './account.mjs';
export { cleanEnvironment } from './runtime.mjs';
const instructions = await readFile(new URL('./instructions.txt', import.meta.url), 'utf8');
const schema = JSON.parse(await readFile(new URL('./schema.json', import.meta.url), 'utf8'));
export const MODEL = 'gpt-6-luna';
export const LANGUAGES = {ru:'Russian',en:'English',de:'German',fr:'French',es:'Spanish',zh:'Simplified Chinese',ja:'Japanese'};
export function validateRequest(data) {
  if (!data || !Object.hasOwn(LANGUAGES,data.target) || !Array.isArray(data.segments) || !data.segments.length || data.segments.length>16) throw new Error('Invalid translation request');
  const ids=new Set(); let size=0;
  for (const s of data.segments) {
    if (!s || typeof s.id!=='string' || s.id.length>80 || ids.has(s.id) || typeof s.text!=='string' || !s.text.trim() || s.text.length>6000) throw new Error('Invalid segment');
    ids.add(s.id); size+=s.text.length;
  }
  if(size>14000) throw new Error('Batch is too large');
  return {target:LANGUAGES[data.target],segments:data.segments.map(({id,text})=>({id,text}))};
}
export function validateResult(text, request) {
  let result; try {result=JSON.parse(text);} catch {throw new Error('The model returned invalid JSON');}
  if(!Array.isArray(result?.segments) || result.segments.length!==request.segments.length) throw new Error('Incomplete translation');
  const originals=new Map(request.segments.map(s=>[s.id,s.text])); const seen=new Set();
  for(const s of result.segments) {
    if(!originals.has(s.id)||seen.has(s.id)||typeof s.text!=='string'||!s.text.trim()||s.text.length>24000) throw new Error('Invalid translated segment');
    const markers=t=>t.match(/<\/?\d+>/g)||[];
    if(JSON.stringify(markers(originals.get(s.id)))!==JSON.stringify(markers(s.text))) throw new Error('Translation changed inline formatting; retry');
    seen.add(s.id);
  }
  return result;
}

export async function consumeResponse(response) {
  if (!response.ok) throw new Error(response.status === 429 ? 'ChatGPT usage limit reached. Manage usage in ChatGPT Settings → Usage.' : response.status === 401 ? 'Continue with ChatGPT to renew your connection.' : 'ChatGPT could not complete the translation. Please try again.');
  if (!response.body) throw new Error('ChatGPT returned an empty stream.');
  let buffer = '', text = '', bytes = 0;
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4_000_000) throw new Error('ChatGPT response exceeded the translation limit.');
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        if (event.type === 'response.output_text.delta') text += event.delta || '';
        if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) {
          const code = event.response?.error?.code || event.error?.code || event.code;
          throw new Error(['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable'].includes(code) ? 'ChatGPT plan usage is unavailable or its limit was reached. Manage usage in ChatGPT Settings → Usage.' : 'ChatGPT did not complete the translation. Please try again.');
        }
        if (event.type === 'response.completed') {
          if (event.response?.status !== 'completed') throw new Error('ChatGPT did not complete the translation.');
          const output = event.response.output?.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('');
          return { text: output || text, usage: event.response.usage || null };
        }
      }
    }
    throw new Error('ChatGPT stream ended before the translation completed.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function translate(data, { signal, account = { resolveModel, access }, fetchImpl = fetch } = {}) {
  const request = validateRequest(data);
  const selected = await account.resolveModel(data.model || MODEL, data.speed || 'standard');
  const { token } = await account.access(selected.profileId);
  const timeout = AbortSignal.timeout(90000);
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selected.model, instructions, input: [{ role: 'user', content: JSON.stringify(request) }], store: false, stream: true, text: { format: { type: 'json_schema', name: 'translation', strict: true, schema } } }),
    });
    const result = await consumeResponse(response);
    return { ...validateResult(result.text, request), model: selected.model, speed: selected.speed, usage: result.usage };
  } catch (error) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (timeout.aborted) throw new Error('ChatGPT did not respond within 90 seconds. Please try again.');
    throw error;
  }
}
