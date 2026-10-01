(()=>{
 const page=parent!==window?parent:window;
 page.lunaPreviewPrefs ||= {target:'ru',mode:'translation',model:'gpt-6-luna',speed:'standard',theme:'light'};
 try{page.lunaPreviewPrefs.launcherPosition=JSON.parse(localStorage.getItem('luna-launcher-position')||'null');page.lunaPreviewPrefs.launcherHidden=localStorage.getItem('luna-launcher-hidden')==='true'}catch{}
 const cache=new Map();const active=new Set();
 window.chrome={storage:{onChanged:{addListener(fn){page.addEventListener('luna-prefs',e=>fn(e.detail,'local'))}},local:{async get(){return page.lunaPreviewPrefs},async set(value){const changes=Object.fromEntries(Object.entries(value).map(([key,newValue])=>[key,{oldValue:page.lunaPreviewPrefs[key],newValue}]));page.lunaPreviewPrefs={...page.lunaPreviewPrefs,...value};if(value.launcherPosition)try{localStorage.setItem('luna-launcher-position',JSON.stringify(value.launcherPosition))}catch{}if('launcherHidden' in value)try{localStorage.setItem('luna-launcher-hidden',String(value.launcherHidden))}catch{};page.dispatchEvent(new CustomEvent('luna-prefs',{detail:changes}))}}},tabs:{async query(){return[{id:1,url:location.origin,title:'Lunori · Preview'}]},async sendMessage(id,message){return new Promise(resolve=>{if(page.lunaMessage)page.lunaMessage(message,{},resolve);else resolve({enabled:false,done:0,working:false})})}},runtime:{onMessage:{addListener(callback){window.lunaMessage=callback}},async sendMessage(message){
  if(message.type==='health')return {ok:true};
  if(['catalog','login','loginCancel'].includes(message.type)){const response=await fetch('/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)});return response.json();}
  if(message.type==='translate'){
   const key=JSON.stringify([message.target,message.model||'gpt-6-luna',message.speed||'standard',message.segments.map(s=>s.text)]);
   if(cache.has(key))return {segments:cache.get(key).map((text,i)=>({id:message.segments[i].id,text}))};
   const controller=new AbortController();active.add(controller);
   try{const result=await fetch('/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),signal:controller.signal});const output=await result.json();if(output.segments)cache.set(key,output.segments.map(s=>s.text));return output}finally{active.delete(controller)}
  }
  if(message.type==='cancel'){for(const controller of active)controller.abort();return {ok:true}}
  if(message.type==='clearCache'){page.clearLunaPreviewCache?.();return {ok:true}}
  if(message.type==='action')return new Promise(resolve=>{if(page.lunaMessage)page.lunaMessage({...message.options,type:message.action},{},resolve);else resolve({error:'The page is still loading'})});
  return {ok:true};
 }}};
 window.clearLunaPreviewCache=()=>cache.clear();
 const root=document.getElementById('root');if(root&&parent!==window)new ResizeObserver(()=>parent.postMessage({type:'luna-preview-size',height:Math.ceil(root.getBoundingClientRect().height)},location.origin)).observe(root);
})();
