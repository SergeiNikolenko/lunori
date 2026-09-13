import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { binary,cleanEnvironment,privateHome,accountChoice,linkedAccount } from './runtime.mjs';
const sessions=new Map();let login=null,cached=null;
class Session{
 constructor(linked){
  this.next=0;this.pending=new Map();this.closed=false;
  this.child=spawn(binary,['app-server','-c','model_provider="openai"','-c','forced_login_method="chatgpt"',...(linked?['-c','cli_auth_credentials_store="file"']:[])],{cwd:tmpdir(),env:cleanEnvironment({linked}),stdio:['pipe','pipe','ignore']});
  let buffer='';this.child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>4e6){this.close();return}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let event;try{event=JSON.parse(line)}catch{continue}const pending=this.pending.get(event.id);if(pending){clearTimeout(pending.timer);this.pending.delete(event.id);event.error?pending.reject(new Error(event.error.message||'Account service failed')):pending.resolve(event.result)}else if(event.method==='account/login/completed'&&login?.id===event.params?.loginId){void finishLogin(event.params).catch(()=>{login={...login,pending:false,error:'Could not save the connection'};cached=null})}}});
  this.child.on('error',()=>this.close());this.child.on('exit',()=>this.close());this.child.stdin.on('error',()=>{});
  this.ready=this.call('initialize',{clientInfo:{name:'luna_translate',version:'0.3.0'},capabilities:{experimentalApi:true}}).then(()=>this.child.stdin.write('{"method":"initialized"}\n'));
 }
 call(method,params={}){return new Promise((resolve,reject)=>{if(this.closed)return reject(new Error('Companion disconnected'));const id=++this.next;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('The account service did not respond'))},20000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n')})}
 async request(method,params={}){await this.ready;return this.call(method,params)}
 close(){if(this.closed)return;this.closed=true;this.child.kill();for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error('Companion disconnected'))}this.pending.clear()}
}
async function session(linked=linkedAccount()){if(linked)await mkdir(privateHome,{recursive:true,mode:0o700});let current=sessions.get(linked);if(!current||current.closed){current=new Session(linked);sessions.set(linked,current)}return current}
async function finishLogin(result){
 if(!login)return;
 login={...login,pending:false,error:result.success?null:(result.error||'Sign-in was not completed')};cached=null;
 if(result.success){await mkdir(dirname(accountChoice),{recursive:true,mode:0o700});await writeFile(accountChoice,JSON.stringify({linked:true}),{mode:0o600});cached=null;}
}
export async function catalog({refresh=false}={}){
 if(!refresh&&cached&&Date.now()-cached.time<60000)return cached.value;
 const current=await session();const account=await current.request('account/read',{refreshToken:false});
 const models=[];let cursor;do{const response=await current.request('model/list',{includeHidden:false,limit:100,...(cursor?{cursor}:{})});models.push(...response.data);cursor=response.nextCursor;}while(cursor);
 const value={account:account.account?.type==='chatgpt'?{connected:true,email:account.account.email||'',plan:account.account.planType||'',source:linkedAccount()?'linked':'computer'}:{connected:false},models:models.filter(m=>!m.hidden&&(!m.inputModalities||m.inputModalities.includes('text'))).map(m=>({id:m.model,name:m.displayName,efforts:m.supportedReasoningEfforts.map(e=>e.reasoningEffort),fast:(m.additionalSpeedTiers||[]).includes('fast')||(m.serviceTiers||[]).some(t=>t.id==='priority')})),login:login?{pending:login.pending,error:login.error}:null};
 cached={time:Date.now(),value};return value;
}
export async function startLogin(){
 if(login?.pending)await cancelLogin();
 const current=await session(true);const response=await current.request('account/login/start',{type:'chatgpt',useHostedLoginSuccessPage:true,appBrand:'chatgpt'});
 const url=new URL(response.authUrl);if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com','auth.chatgpt.com'].includes(url.hostname))throw new Error('Unexpected sign-in URL');
 login={id:response.loginId,pending:true,error:null};cached=null;return {authUrl:response.authUrl};
}
export async function cancelLogin(){if(login?.pending){const current=await session(true);await current.request('account/login/cancel',{loginId:login.id})}login=null;cached=null;return {ok:true}}
export async function resolveModel(model='gpt-5.6-luna',speed='standard'){
 if(!['standard','fast'].includes(speed))throw new Error('Unknown speed');
 const state=await catalog();if(!state.account.connected)throw new Error('Connect your ChatGPT account');
 const selected=state.models.find(m=>m.id===model);if(!selected)throw new Error('This model is unavailable for your account');
 if(speed==='fast'&&!selected.fast)throw new Error('This model does not support Fast');
 return {model:selected.id,effort:selected.efforts.includes('low')?'low':selected.efforts[0],speed};
}
export function closeAccount(){for(const current of sessions.values())current.close();sessions.clear()}
