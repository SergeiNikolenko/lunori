import { cleanEnvironment,linkedAccount,binary as defaultBinary } from './runtime.mjs';
export { cleanEnvironment } from './runtime.mjs';
import { resolveModel } from './account.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = fileURLToPath(new URL('.', import.meta.url));
export const MODEL = 'gpt-5.6-luna';
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
export async function translate(data,{signal,binary=defaultBinary}={}) {
  const request=validateRequest(data);
  const selected=await resolveModel(data.model||MODEL,data.speed||'standard');
  const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','-C',tmpdir(),'-m',selected.model,'-s','read-only','--json','--output-schema',here+'schema.json'];
  const config={approval_policy:'never',model_reasoning_effort:selected.effort,project_doc_max_bytes:0,model_instructions_file:here+'instructions.txt',forced_login_method:'chatgpt',web_search:'disabled'};
  if(linkedAccount())config.cli_auth_credentials_store='file';
  if(selected.speed==='fast')config.service_tier='fast';
  for(const feature of ['shell_tool','apps','plugins','hooks','multi_agent','browser_use','browser_use_external','computer_use','image_generation','view_image','code_mode','code_mode_host','workspace_dependencies','tool_suggest','goals','sleep_tool','skill_search','memory_tool']) config['features.'+feature]=false;
  config['features.skip_host_skill_discovery']=true;
  for(const [key,value] of Object.entries(config)) args.push('-c',key+'='+JSON.stringify(value));
  args.push('-');
  return new Promise((resolve,reject)=>{
    if(signal?.aborted) return reject(new Error('Cancelled'));
    const child=spawn(binary,args,{cwd:tmpdir(),env:cleanEnvironment(),stdio:['pipe','pipe','pipe'],detached:true});
    let output='',pending='',failure='',settled=false,usage=null;
    const stop=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(err){stop();reject(err);}else resolve(value);};
    const abort=()=>finish(new Error('Cancelled'));
    const timer=setTimeout(()=>finish(new Error('The model did not respond within 90 seconds. Try again.')),90000);
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',()=>finish(new Error('Codex could not start. Reinstall the local helper.')));
    child.stdin.on('error',()=>{});
    child.stderr.on('data',()=>{}); // Never persist credentials, excerpts, or runtime diagnostics.
    child.stdout.on('data',chunk=>{
      pending+=chunk;
      if(pending.length>2_000_000)return finish(new Error('Model response exceeded limit'));
      let index;
      while((index=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,index);pending=pending.slice(index+1);
        let e;try{e=JSON.parse(line);}catch{continue;}
        if(e.type==='item.completed' && e.item?.type==='agent_message') output=e.item.text;
        if(e.type==='turn.completed') usage=e.usage;
        if(e.type==='turn.failed'||e.type==='error') failure='ChatGPT request failed. Check sign-in and subscription limits.';
        if(e.type==='item.started' && ['command_execution','mcp_tool_call','web_search','file_change'].includes(e.item?.type)) return finish(new Error('Unexpected tool request blocked'));
      }
    });
    child.on('close',code=>{
      if(settled)return;
      if(code!==0||!output)return finish(new Error(failure||'The model returned no translation. Check ChatGPT sign-in and limits.'));
      try {finish(null,{...validateResult(output,request),model:selected.model,speed:selected.speed,usage});} catch(err){finish(err);}
    });
    child.stdin.end(JSON.stringify(request));
  });
}
