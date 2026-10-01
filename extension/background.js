const HOST='com.lunatranslate.bridge';
const DEFAULTS={target:'ru',mode:'translation',model:'gpt-6-luna',speed:'standard'};
let nativePort=null,queue=[],running=new Set();
const pending=new Map(),cache=new Map();
function connect(){
  if(nativePort)return nativePort;
  const port=chrome.runtime.connectNative(HOST);nativePort=port;
  port.onMessage.addListener(message=>{
    const task=pending.get(message.id);if(!task)return;
    clearTimeout(task.timer);pending.delete(message.id);
    message.error?task.reject(new Error(message.error)):task.resolve(message);
  });
  port.onDisconnect.addListener(()=>{
    const message=chrome.runtime.lastError?.message || 'The local companion disconnected';
    if(nativePort===port)nativePort=null;
    for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error(message));}pending.clear();
  });
  return port;
}
function request(payload,job){return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Translation timed out. Please try again.'));},100000);
  pending.set(id,{resolve,reject,timer});
  try{connect().postMessage({...payload,id});}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
  if(job)job.nativeId=id;
});}
function cacheKey(message,text){return [message.target,message.model||'gpt-6-luna',message.speed||'standard',text].join('\0');}
function put(key,text){cache.delete(key);cache.set(key,text);while(cache.size>600)cache.delete(cache.keys().next().value);}
async function pump(){
  if(running.size>=3||!queue.length)return;
  const job=queue.shift();running.add(job);void pump();
  try{
    if(job.cancelled)throw new Error('Cancelled');
    const missing=job.message.segments.filter(s=>!cache.has(cacheKey(job.message,s.text)));
    if(missing.length){const translated=await request({type:'translate',target:job.message.target,model:job.message.model,speed:job.message.speed,segments:missing},job);
      const source=new Map(missing.map(s=>[s.id,s.text]));
      for(const segment of translated.segments)put(cacheKey(job.message,source.get(segment.id)),segment.text);
    }
    job.reply(job.cancelled?{error:'Cancelled'}:{segments:job.message.segments.map(s=>({id:s.id,text:cache.get(cacheKey(job.message,s.text))}))});
  }catch(e){job.reply({error:e.message});}
  finally{running.delete(job);void pump();}
}
function cancel(tabId){
  const cancelled=queue.filter(j=>j.tabId===tabId);queue=queue.filter(j=>j.tabId!==tabId);
  cancelled.forEach(j=>j.reply({error:'Cancelled'}));
  for(const job of running)if(job.tabId===tabId){job.cancelled=true;if(job.nativeId)nativePort?.postMessage({id:crypto.randomUUID(),type:'cancel',requestId:job.nativeId});}
}
async function settings(){return {...DEFAULTS,...await chrome.storage.local.get(DEFAULTS)};}
async function ensure(tabId){
  try{await chrome.tabs.sendMessage(tabId,{type:'state'});}catch{await chrome.scripting.executeScript({target:{tabId},files:['content.js']});}
}
async function action(tabId,type,extra={}){await ensure(tabId);return chrome.tabs.sendMessage(tabId,{type,...await settings(),...extra});}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.type==='translate' && sender.tab){
    if(!Array.isArray(message.segments)||message.segments.length>16||queue.length>=12){reply({error:'The queue is full. Please try again.'});return;}
    queue.push({message,tabId:sender.tab.id,reply});void pump();return true;
  }
  if(message.type==='cancel' && sender.tab){cancel(sender.tab.id);reply({ok:true});return;}
  if(['catalog','login','loginCancel'].includes(message.type)){if(message.type==='login')cache.clear();request({type:message.type,refresh:!!message.refresh,newProfile:!!message.newProfile}).then(reply,e=>reply({error:e.message}));return true;}
  if(sender.tab)return;
  if(message.type==='health'){request({type:'ping'}).then(reply,e=>reply({error:e.message}));return true;}
  if(message.type==='action'){action(message.tabId,message.action,message.options).then(reply,e=>reply({error:e.message}));return true;}
  if(message.type==='clearCache'){cache.clear();reply({ok:true});}
});
chrome.tabs.onRemoved.addListener(cancel);
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='loading')cancel(id);});
chrome.commands.onCommand.addListener(async command=>{
  if(command!=='toggle-translation')return;
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id)try{await action(tab.id,'toggle');}catch{}
});
chrome.runtime.onInstalled.addListener(()=>{
  chrome.contextMenus.create({id:'luna-selection',title:'Translate selection with Lunori',contexts:['selection']});
});
chrome.contextMenus.onClicked.addListener(async(info,tab)=>{
  if(info.menuItemId==='luna-selection'&&tab?.id)try{await action(tab.id,'selection',{text:info.selectionText});}catch{}
});
