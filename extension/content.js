(()=>{
  if(globalThis.__lunaTranslate)return;globalThis.__lunaTranslate=true;
  const BLOCKS='p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dd,dt,div,section,article,[role="paragraph"]';
  const EXCLUDE='script,style,noscript,template,pre,code,kbd,samp,svg,math,canvas,textarea,input,select,button,form,nav,footer,header,aside,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[aria-hidden="true"],[hidden],[data-luna-owned]';
  const INLINE=new Set(['A','STRONG','EM','B','I','U','S','SPAN','SMALL','SUP','SUB','MARK','ABBR','BR','CODE','KBD','MATH']);
  let enabled=false,target='ru',mode='translation',model='gpt-5.6-luna',speed='standard',epoch=0,sequence=0,working=false,activeBatches=0,error='',done=0;
  let observer=null,intersection=null,timer=null,hovered=null;
  const records=new Map(),ready=new Set();
  const owned=new Set();
  function send(message){return chrome.runtime.sendMessage(message);}
  function own(node){node.setAttribute('data-luna-owned','');owned.add(node);return node;}
  function visible(el){const style=getComputedStyle(el);return el.getClientRects().length>0&&style.visibility!=='hidden'&&style.display!=='none';}
  function eligible(el){
    if(el.closest(EXCLUDE)||records.has(el)||!visible(el))return false;
    if(el.querySelector(BLOCKS)||el.querySelector('input,button,textarea,select,[contenteditable]:not([contenteditable="false"]),img,video,iframe'))return false;
    const text=el.textContent.trim();return text.length>=8&&text.length<=5500&&/\p{L}/u.test(text);
  }
  function serialize(el){
    const tags=[];
    function walk(node){
      if(node.nodeType===Node.TEXT_NODE)return node.nodeValue;
      if(node.nodeType!==Node.ELEMENT_NODE)return '';
      if(node.matches('[data-luna-owned],script,style,svg'))return '';
      if(!INLINE.has(node.tagName))return [...node.childNodes].map(walk).join('');
      const id=tags.length;tags.push(node);
      if(['CODE','KBD','MATH'].includes(node.tagName))return `<${id}></${id}>`;
      return `<${id}>${[...node.childNodes].map(walk).join('')}</${id}>`;
    }
    return {text:[...el.childNodes].map(walk).join(''),tags};
  }
  function render(text,tags){
    const fragment=document.createDocumentFragment(),stack=[fragment];
    const tokens=text.split(/(<\/?\d+>)/g);
    for(const token of tokens){
      const match=token.match(/^<(\/?)(\d+)>$/);
      if(!match){stack.at(-1).append(document.createTextNode(token));continue;}
      if(match[1]){if(stack.length<2)throw new Error('Invalid formatting');stack.pop();continue;}
      const source=tags[Number(match[2])];if(!source)throw new Error('Unknown formatting marker');
      let el;
      if(['CODE','KBD','MATH'].includes(source.tagName)){
        // Keep formulas/code as inert text. Never clone scripts, event handlers or page state.
        el=document.createElement('code');el.textContent=source.textContent;
      }else{
        el=document.createElement(source.tagName.toLowerCase());
        if(source.tagName==='A')try{const url=new URL(source.getAttribute('href'),location.href);if(['https:','http:','mailto:'].includes(url.protocol))el.href=url.href;}catch{}
        if(source.tagName==='A')el.rel='noopener noreferrer';
      }
      stack.at(-1).append(el);stack.push(el);
    }
    if(stack.length!==1)throw new Error('Unclosed formatting');return fragment;
  }
  function translatedView(rec,text){
    const el=own(document.createElement('span'));el.lang=target;el.dir='auto';
    el.style.cssText='display:block!important;font:inherit!important;color:inherit!important;line-height:inherit!important;text-align:inherit!important;letter-spacing:inherit!important;margin:.42em 0 .12em!important;padding:0!important;border:0!important;background:none!important;';
    el.append(render(text,rec.tags));return el;
  }
  function blockIndicator(rec,active=false){
    if(!rec.indicator){
      const indicator=own(document.createElement('span'));indicator.setAttribute('data-luna-progress','');
      indicator.setAttribute('role','img');indicator.style.cssText='display:inline-block!important;width:13px!important;height:13px!important;vertical-align:middle!important;margin:0 0 0 7px!important;padding:0!important;border:0!important;';
      const root=indicator.attachShadow({mode:'closed'}),style=document.createElement('style');
      style.textContent=':host{color:inherit}span{display:block;width:11px;height:11px;box-sizing:border-box;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;opacity:.35;animation:waiting 1.2s ease-in-out infinite}@keyframes waiting{50%{opacity:.65}}:host([data-active]) span{opacity:.75;animation:spin .75s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){span{animation:none!important}}';
      root.append(style,document.createElement('span'));rec.el.append(indicator);rec.indicator=indicator;
    }
    rec.indicator.toggleAttribute('data-active',active);
    rec.indicator.setAttribute('aria-label',active?'Translating':'Waiting to translate');
  }
  function clearIndicator(rec){rec.indicator?.remove();owned.delete(rec.indicator);rec.indicator=null;}
  function apply(rec,text){
    clearIndicator(rec);
    if(!rec.el.isConnected||rec.el.textContent!==rec.originalText)return;
    if(text.replace(/\s+/g,' ').trim()===rec.text.replace(/\s+/g,' ').trim())return;
    rec.view=translatedView(rec,text);
    if(mode==='translation'){
      rec.originalNodes=[...rec.el.childNodes];rec.originalNodes.forEach(n=>n.remove());
      rec.view.style.setProperty('margin','0','important');
    }
    rec.el.append(rec.view);done++;
  }
  function add(el){
    if(!eligible(el))return;
    const data=serialize(el);if(data.text.length>6000)return;
    const rec={el,...data,id:String(++sequence),originalText:el.textContent,state:'pending',view:null};records.set(el,rec);
    intersection?.observe(el);
  }
  function scan(){
    if(!enabled)return;
    // Leaf blocks avoid translating navigation and parent/child text twice.
    for(const el of document.querySelectorAll(BLOCKS))add(el);
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>void flush(),40);}
  async function flush(){
    if(activeBatches>=3||error||!ready.size||!enabled)return;
    const batch=[];let size=0;
    for(const rec of ready){
      if(!rec.el.isConnected){ready.delete(rec);records.delete(rec.el);continue;}
      if(batch.length>=6||size+rec.text.length>12000)break;
      ready.delete(rec);rec.state='working';blockIndicator(rec,true);batch.push(rec);size+=rec.text.length;
    }
    if(!batch.length)return;
    activeBatches++;working=true;const version=epoch;updateDock();
    if(ready.size)void flush();
    try{
      const result=await send({type:'translate',target,model,speed,segments:batch.map(({id,text})=>({id,text}))});
      if(version!==epoch)return;
      if(result.error)throw new Error(result.error);
      const byId=new Map(result.segments.map(s=>[s.id,s.text]));
      for(const rec of batch){if(byId.has(rec.id)){apply(rec,byId.get(rec.id));rec.state='done';}else throw new Error('Some paragraphs were not translated');}
    }catch(e){if(version===epoch){error=e.message;for(const rec of batch){rec.state='error';clearIndicator(rec);}}}
    finally{if(version===epoch){activeBatches--;working=activeBatches>0;updateDock();if(!error&&ready.size)void flush();}}
  }
  function restoreRecord(rec){
    clearIndicator(rec);
    if(rec.originalNodes&&rec.view?.isConnected){
      // Restore only our translated subtree, leaving later site-owned DOM untouched.
      rec.view.before(...rec.originalNodes);
    }
    rec.view?.remove();owned.delete(rec.view);
  }
  function stop(){
    enabled=false;epoch++;working=false;activeBatches=0;error='';clearTimeout(timer);clearTimeout(scanTimer);
    observer?.disconnect();intersection?.disconnect();observer=null;intersection=null;
    for(const rec of records.values())restoreRecord(rec);
    for(const el of owned)el.remove();owned.clear();records.clear();ready.clear();done=0;
    dock=null;updateLauncher();void send({type:'cancel'}).catch(()=>{});
  }
  function start(options={}){
    stop();target=options.target||target;mode=options.mode||mode;model=options.model||model;speed=options.speed||speed;enabled=true;
    intersection=new IntersectionObserver(entries=>{
      for(const entry of entries){const rec=records.get(entry.target);if(entry.isIntersecting&&rec?.state==='pending'){ready.add(rec);blockIndicator(rec);intersection.unobserve(entry.target);}}
      schedule();
    },{rootMargin:'300px 0px'});
    observer=new MutationObserver(mutations=>{
      let changed=false;
      for(const mutation of mutations){
        if(mutation.target.nodeType===1&&mutation.target.closest('[data-luna-owned]'))continue;
        if(mutation.type==='childList'&&[...mutation.addedNodes,...mutation.removedNodes].every(n=>n.nodeType===1&&n.hasAttribute('data-luna-owned')))continue;
        changed=true;
        for(const [el,rec] of records){
          if(!el.isConnected){clearIndicator(rec);ready.delete(rec);records.delete(el);continue;}
          if(el===mutation.target||el.contains(mutation.target)){
            const expected=rec.originalNodes?rec.view?.textContent:rec.originalText+(rec.view?.textContent||'');
            if(el.textContent!==expected){clearIndicator(rec);rec.view?.remove();ready.delete(rec);records.delete(el);}
          }
        }
      }
      if(changed){clearTimeout(scanTimer);scanTimer=setTimeout(scan,250);}
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});scan();updateDock();
  }
  let scanTimer=null,dock=null;
  const css=`:host{all:initial;color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--bg:#fff;--fg:#171717;--muted:#737373;--line:#e5e5e5;--accent:#171717;color:var(--fg)}@media(prefers-color-scheme:dark){:host{--bg:#0a0a0a;--fg:#ededed;--muted:#a1a1a1;--line:#292929;--accent:#ededed}}*{box-sizing:border-box}button{font:inherit;cursor:pointer;color:inherit;border:0;background:none;border-radius:9px;padding:8px}button:hover{background:color-mix(in srgb,var(--fg) 8%,transparent)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.bar{display:flex;align-items:center;gap:9px;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:8px;box-shadow:0 2px 12px #0002;padding:5px 7px 5px 14px;font-size:12px}.dot{width:7px;height:7px;border-radius:50%;background:var(--accent)}.label{max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sheet{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:10px;box-shadow:0 4px 20px #0002;width:min(380px,calc(100vw - 32px));padding:20px;font-size:15px;line-height:1.6}:host([data-side=right]) .tip{left:42px;right:auto}:host([data-side=right]) .tip-arrow{left:auto;right:100%;transform:translateY(-50%) rotate(180deg)}.panel::before{content:"";position:fixed;right:-12px;top:0;width:12px;height:100%}.trigger[aria-busy=true]{outline:2px solid var(--muted);outline-offset:3px}.trigger[aria-busy=true] svg{animation:luna-pulse 1s ease-in-out infinite}@keyframes luna-pulse{50%{opacity:.35}}.head{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);margin-bottom:12px}.result{white-space:pre-wrap;max-height:50vh;overflow:auto;overscroll-behavior:contain;overflow-wrap:anywhere}.original{font-size:12px;color:var(--muted);max-height:70px;overflow:auto;margin-bottom:12px}`;
  function surface(){const el=own(document.createElement('div'));el.style.cssText='position:fixed!important;bottom:22px!important;right:22px!important;z-index:2147483646!important;display:block!important;';document.documentElement.append(el);const root=el.attachShadow({mode:'closed'});const style=document.createElement('style');style.textContent=css;root.append(style);return {el,root};}
  function updateDock(){
    updateLauncher();
    if(!enabled)return;
    if(!dock){dock=surface();const bar=document.createElement('div');bar.className='bar';
      const dot=document.createElement('span');dot.className='dot';
      const label=document.createElement('span');label.className='label';label.setAttribute('role','status');
      const retry=document.createElement('button');retry.textContent='↻';retry.title='Retry';retry.setAttribute('aria-label','Retry translation');retry.onclick=()=>{error='';for(const rec of records.values())if(rec.state==='error'){rec.state='pending';ready.add(rec);}schedule();updateDock();};
      const close=document.createElement('button');close.textContent='×';close.title='Show original';close.setAttribute('aria-label','Show original');close.onclick=stop;
      bar.append(dot,label,retry,close);dock.root.append(bar);dock.label=label;dock.retry=retry;
    }
    dock.label.textContent=error?'Translation failed':working?'Lunori is translating…':done?`Lunori · ${done} blocks`:'Lunori · ready';
    dock.label.title=error;dock.retry.hidden=!error;
  }
  async function selection(text){
    text=text?.trim();if(!text||text.length>5500)return {error:'Select up to 5,500 characters'};
    const panel=surface();const previousFocus=document.activeElement;const box=document.createElement('div');box.className='sheet';box.setAttribute('role','dialog');box.setAttribute('aria-label','Selection translation');
    const head=document.createElement('div');head.className='head';head.textContent='Lunori · Selection translation';
    const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Close');close.onclick=()=>{panel.el.remove();owned.delete(panel.el);previousFocus?.focus?.();};box.addEventListener('keydown',e=>{if(e.key==='Escape')close.click();});head.append(close);
    const original=document.createElement('div');original.className='original';original.textContent=text;
    const result=document.createElement('div');result.className='result';result.setAttribute('role','status');result.textContent='Translating…';box.append(head,original,result);panel.root.append(box);close.focus();
    try{const response=await send({type:'translate',target,model,speed,segments:[{id:'selection',text}]});result.textContent=response.error||response.segments[0].text;}catch(e){result.textContent=e.message;}
    return {ok:true};
  }
  document.addEventListener('pointerover',event=>{hovered=event.target.closest?.(BLOCKS);},{passive:true});
  document.addEventListener('keydown',event=>{
    if(event.altKey&&event.shiftKey&&event.code==='KeyL'&&!event.repeat&&!event.target.closest('input,textarea,[contenteditable="true"]')){
      event.preventDefault();const text=getSelection()?.toString();
      if(text)void selection(text);else if(hovered&&!hovered.closest(EXCLUDE)){
        if(!enabled){enabled=true;updateDock();}
        add(hovered);const rec=records.get(hovered);if(rec?.state==='pending'){ready.add(rec);schedule();}
      }
    }
  });
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message.type==='showLauncher'){hideLauncher(false);reply({ok:true});return;}
    if(message.type==='state'){reply({enabled,target,mode,model,speed,done,working,error});return;}
    if(message.type==='start'){start(message);reply({enabled:true});}
    if(message.type==='stop'){stop();reply({enabled:false});}
    if(message.type==='toggle'){enabled?stop():start(message);reply({enabled});}
    if(message.type==='selection'){target=message.target||target;model=message.model||model;speed=message.speed||speed;void selection(message.text);reply({ok:true});}
  });
  // A persistent launcher is separate from translated content, so Restore never removes it.
  const launcher=document.createElement('div');
  launcher.setAttribute('data-luna-owned','');launcher.setAttribute('data-luna-launcher','');
  launcher.style.cssText='position:fixed!important;right:16px!important;top:46%!important;z-index:2147483647!important;display:block!important;';
  const launcherRoot=launcher.attachShadow({mode:'closed'});
  const launcherStyle=document.createElement('style');
  launcherStyle.textContent=`:host{all:initial;--bg:#fff;--fg:#171717;--muted:#737373;--line:#e5e5e5;--soft:#f5f5f5;--tip-bg:#0a0a0a;--tip-fg:#ededed;--tip-key:#2e2e2e;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--fg);color-scheme:light} @media(prefers-color-scheme:dark){:host{--bg:#0a0a0a;--fg:#ededed;--muted:#a1a1a1;--line:#292929;--soft:#1f1f1f;--tip-bg:#fff;--tip-fg:#171717;--tip-key:#eaeaea;color-scheme:dark}}:host([data-theme=light]){--bg:#fff;--fg:#171717;--muted:#737373;--line:#e5e5e5;--soft:#f5f5f5;--tip-bg:#0a0a0a;--tip-fg:#ededed;--tip-key:#2e2e2e;color-scheme:light}:host([data-theme=dark]){--bg:#0a0a0a;--fg:#ededed;--muted:#a1a1a1;--line:#292929;--soft:#1f1f1f;--tip-bg:#fff;--tip-fg:#171717;--tip-key:#eaeaea;color-scheme:dark}*{box-sizing:border-box}button,select{font:inherit;cursor:pointer}button:focus-visible,select:focus-visible{outline:2px solid var(--muted);outline-offset:3px}.trigger{width:32px;height:32px;padding:0;display:grid;place-items:center;background:var(--fg);color:var(--bg);border:1px solid color-mix(in srgb,var(--fg) 80%,var(--bg));border-radius:50%;box-shadow:0 1px 4px #0002;touch-action:none;user-select:none;transition:transform 150ms ease,box-shadow 150ms ease,opacity 150ms ease}.trigger:hover{transform:scale(1.08);box-shadow:0 3px 9px #0003}.trigger:active{transform:scale(.93)}.trigger[data-dragging]{cursor:grabbing;transform:scale(1.1);box-shadow:0 5px 14px #0003;transition:none}.trigger svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}/* Geometry and colors verified against vercel.com/geist/tooltip. */
.tip{position:absolute;right:42px;top:16px;transform:translateY(-50%);display:inline-flex;align-items:center;gap:4px;width:max-content;max-width:min(250px,calc(100vw - 80px));padding:6px 6px 6px 8px;border-radius:8px;border:0;background:var(--tip-bg);color:var(--tip-fg);box-shadow:none;font-family:Geist,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;font-weight:400;line-height:1.3;text-align:center;white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden;transition:opacity 100ms ease-in,visibility 100ms}.tip-arrow{position:absolute;left:100%;top:50%;transform:translateY(-50%);width:6px;height:14px;fill:var(--tip-bg)}.tip kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 4px;background:var(--tip-key);color:var(--tip-fg);border:0;border-radius:4px;font:12px ui-monospace,SFMono-Regular,monospace;box-shadow:none}.trigger:hover+.tip,.trigger:focus-visible+.tip{opacity:1;visibility:visible;transition-delay:400ms}.trigger[aria-expanded=true]+.tip,.trigger[data-tip-dismissed]+.tip{visibility:hidden;opacity:0;transition-delay:0ms}.panel{position:absolute;right:42px;top:16px;transform:translateY(-50%);width:min(280px,calc(100vw - 24px));padding:0;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:12px;box-shadow:0 0 0 1px #00000005,0 8px 24px -8px #0003;overflow:auto;max-height:min(500px,80vh)}[hidden]{display:none!important}:host([data-side=right]) .tip{left:42px;right:auto}:host([data-side=right]) .tip-arrow{left:auto;right:100%;transform:translateY(-50%) rotate(180deg)}.panel::before{content:"";position:fixed;right:-12px;top:0;width:12px;height:100%}.trigger[aria-busy=true]{outline:2px solid var(--muted);outline-offset:3px}.trigger[aria-busy=true] svg{animation:luna-pulse 1s ease-in-out infinite}@keyframes luna-pulse{50%{opacity:.35}}.head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);font-weight:600;font-size:13px}.close{border:0;background:none;color:var(--muted);width:24px;height:24px;border-radius:5px;font-size:18px}.close:hover{background:var(--soft)}.body{padding:16px;display:grid;gap:14px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}select{height:36px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);padding:0 9px;max-width:150px}.segments{display:flex;background:var(--soft);border-radius:7px;padding:3px;gap:2px}.segments button{flex:1;padding:7px 4px;border:0;background:transparent;color:var(--muted);border-radius:5px;font-size:12px;white-space:nowrap}.segments button[aria-pressed=true]{background:var(--bg);color:var(--fg);box-shadow:0 1px 3px #0001}.primary{height:38px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--fg);color:var(--bg);border:0;border-radius:7px;font-size:13px;font-weight:500}.primary:hover{opacity:.9}.hint{font-size:11px;line-height:1.5;color:var(--muted);margin:0}.foot{padding:9px 16px;border-top:1px solid var(--line);display:flex;justify-content:space-between;color:var(--muted);font-size:10px}@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;
  // Vercel Toolbar reference: compact dark capsule, separate action/menu, edge docking.
  launcherStyle.textContent+=`
.toolbar{position:relative;display:flex;flex-direction:column;align-items:center;width:32px;height:32px;padding:2px;background:#303030;color:#ededed;border:1px solid #181818;border-radius:999px;box-shadow:inset 0 0 0 1px #ffffff16,0 3px 10px #00000024;transition:height 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms,transform 180ms;touch-action:none;user-select:none}
.toolbar[data-expanded]{height:64px;box-shadow:inset 0 0 0 1px #ffffff20,0 6px 20px #00000026}
.toolbar[data-dragging]{cursor:grabbing;transform:scale(1.025);box-shadow:inset 0 0 0 1px #ffffff24,0 10px 24px #0003;transition:transform 180ms cubic-bezier(.2,.8,.2,1),box-shadow 180ms}
.trigger,.menu-toggle{flex-shrink:0;width:26px;height:26px;padding:0;display:grid;place-items:center;background:transparent;color:#ededed;border:0;border-radius:50%;box-shadow:none;transition:background 120ms,transform 120ms;touch-action:none}
.trigger:hover,.menu-toggle:hover{transform:none;background:#ffffff16;box-shadow:none;opacity:1}.trigger:active,.menu-toggle:active{transform:scale(.91);background:#ffffff25}.trigger svg,.menu-toggle svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.menu-toggle{margin-top:4px;opacity:0;visibility:hidden;transform:translateY(-6px);transition:opacity 120ms,transform 180ms,visibility 120ms}.toolbar[data-expanded] .menu-toggle{opacity:1;visibility:visible;transform:none}
.menu-toggle[data-active]::after{content:'';position:absolute;width:4px;height:4px;right:4px;bottom:20px;border-radius:50%;background:#52a8ff;box-shadow:0 0 0 2px #303030}
.grip{position:absolute;bottom:calc(100% + 5px);left:6px;width:18px;height:14px;display:grid;place-items:center;border:0;border-radius:4px;background:var(--bg);color:var(--muted);cursor:grab;opacity:0;visibility:hidden;transition:opacity 120ms;touch-action:none}.grip svg{width:12px;height:12px;fill:currentColor}.toolbar[data-expanded] .grip{opacity:1;visibility:visible}.toolbar[data-dragging] .grip{cursor:grabbing}
.panel{border-radius:12px;box-shadow:0 0 0 1px #00000004,0 8px 24px -4px #00000022;transform-origin:var(--menu-origin, right center);animation:luna-menu-in 140ms ease-out}
@keyframes luna-menu-in{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.head{padding:12px 14px}.body{padding:6px;gap:2px}.row{padding:8px;font-size:13px}.row select{height:30px;border:0;background:var(--soft)}.segments{background:transparent;padding:0;display:grid;gap:0}.segments button{display:flex;align-items:center;text-align:left;height:34px;padding:0 8px;border-radius:6px;font-size:13px;color:var(--fg)}.segments button:before{content:'';width:14px;margin-right:10px}.segments button[aria-pressed=true]{box-shadow:none;background:var(--soft)}.segments button[aria-pressed=true]:before{content:'✓'}.segments button:hover{background:var(--soft)}.hint{padding:8px;font-size:11px}.primary{height:34px;background:transparent;color:var(--fg);justify-content:flex-start;padding:0 8px;gap:10px;font-size:13px}.primary:before{content:'↵';width:14px}.primary:hover{background:var(--soft);opacity:1}.foot{padding:10px 14px}.trigger[aria-busy=true]{outline:0}.trigger[aria-busy=true] svg{animation:luna-pulse 1s ease-in-out infinite}.toolbar:has(.trigger:hover)+.tip,.toolbar:has(.menu-toggle:hover)+.tip{opacity:1;visibility:visible;transition-delay:350ms}.toolbar:has([aria-expanded=true])+.tip,.toolbar[data-dragging]+.tip{opacity:0;visibility:hidden;transition-delay:0ms}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
  launcherStyle.textContent+=`.menu-row{display:flex;align-items:center;width:100%;height:36px;padding:0 8px;border:0;border-radius:6px;background:none;color:var(--fg);font-size:13px;text-align:left}.menu-row:hover{background:var(--soft)}.hint{font-size:13px}.account-section{padding:2px}.account-info{font-size:13px;line-height:1.5;overflow-wrap:anywhere;padding:8px}.auth-link{display:block;margin:8px;padding:10px;border-radius:6px;background:var(--fg);color:var(--bg);font-size:13px;text-decoration:none}.hide-target{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:grid;place-items:center;pointer-events:none}.hide-target b{display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:#303030;color:#fff;border:1px solid #555;font:28px/1 sans-serif;box-shadow:0 5px 24px #0003;transition:transform 140ms,background 140ms}.hide-target span{font-size:13px;margin-bottom:8px;background:var(--bg);color:var(--fg);padding:3px 8px;border-radius:5px}.hide-target[data-over] b{transform:scale(1.18);background:#b42318}.row select{max-width:175px}.panel{max-height:calc(100vh - 24px)}`;
  /* MENU_THEME_START */
  launcherStyle.textContent += ":host{--menu-muted:var(--muted)}\n/* Shared visual rules for the popup and isolated floating menu. */\n.luna-ui{--bg:var(--background);--fg:var(--foreground);--menu-muted:var(--muted-foreground);--soft:var(--secondary);--line:var(--border);font:13px/1.5 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;letter-spacing:-.01em}\n.menu-title{font-size:14px;font-weight:600;letter-spacing:-.02em;line-height:1.3;flex:1}\n.menu-heading{display:flex;align-items:center;gap:10px;min-height:54px;padding:10px 14px;border-bottom:1px solid var(--line)}\n.menu-heading button{flex-shrink:0}\n.menu-group{display:grid;gap:12px;padding:16px}\n.menu-group+.menu-group{border-top:1px solid var(--line)}\n.account-identity{display:flex;align-items:center;gap:12px;padding:4px 0 16px;min-width:0}\n.account-avatar{display:grid;place-items:center;flex-shrink:0;width:38px;height:38px;border:1px solid var(--line);border-radius:12px;background:var(--soft);color:var(--fg)}\n.account-avatar svg{width:19px;height:19px}\n.account-name{font-size:13px;font-weight:600;overflow-wrap:anywhere;line-height:1.5;color:var(--fg)}\n.account-caption{font-size:13px;line-height:1.5;color:var(--menu-muted);margin-top:2px}\n.account-details{border:1px solid var(--line);border-radius:11px;padding:0 12px;margin:0 0 16px;background:var(--bg)}\n.account-detail{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:40px;font-size:13px}\n.account-detail+.account-detail{border-top:1px solid var(--line)}\n.account-detail>span:first-child{color:var(--menu-muted)}\n.account-value{color:var(--fg);font-weight:500;text-align:right}\n.plan-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:6px;background:var(--soft);font-size:12px;line-height:20px;color:var(--fg);font-weight:500;white-space:nowrap}\n.connection{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:var(--fg)}\n.connection:before{content:'';width:5px;height:5px;border-radius:50%;background:#188653}\n.account-note{margin:12px 0 0;color:var(--menu-muted);font-size:13px;line-height:1.55;text-wrap:pretty}\n.menu-icon{width:16px;height:16px;flex-shrink:0;color:var(--menu-muted);fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}\n.menu-trailing{margin-left:auto;color:var(--menu-muted);display:flex;align-items:center;gap:8px;font-size:12px}\n.menu-action{display:flex;align-items:center;gap:10px;width:100%;min-height:38px;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:var(--fg);font:inherit;text-align:left;cursor:pointer;transition:background 120ms ease}\n.menu-action:hover{background:var(--soft)}\n.menu-action:focus-visible{outline:2px solid var(--menu-muted);outline-offset:2px}\n.menu-action:disabled{opacity:.45;cursor:default}\n.menu-primary{display:flex;align-items:center;justify-content:center;gap:8px;min-height:38px;width:100%;padding:9px 12px;background:var(--fg);color:var(--bg);border:1px solid var(--fg);border-radius:9px;font:inherit;font-weight:500;cursor:pointer;text-decoration:none;text-align:center;transition:opacity 120ms ease}\n.menu-primary:hover{opacity:.88}\n.menu-secondary{background:var(--bg);color:var(--fg);border:1px solid var(--line)}\n.menu-secondary:hover{opacity:1;background:var(--soft)}\n.menu-primary:disabled{opacity:.45;cursor:default}\n@media(prefers-reduced-motion:reduce){.menu-action,.menu-primary{transition:none}}\n";
  /* MENU_THEME_END */
  launcherStyle.textContent+=`.panel{width:min(332px,calc(100vw - 24px));border-radius:15px;box-shadow:0 0 0 1px #00000003,0 12px 40px -12px #0003}.head{gap:10px;min-height:54px;padding:10px 14px}.close{display:grid;place-items:center;width:28px;height:28px;font-size:20px;border-radius:7px}.body{padding:0;gap:0}.body>.row{margin:0;padding:12px 16px 0}.body>.row select{width:180px;max-width:62%;height:34px;background:var(--bg);border:1px solid var(--line);border-radius:8px;font-size:13px;box-shadow:0 1px 2px #00000005}.body>.segments{display:flex;margin:12px 16px 16px;padding:3px;background:var(--soft);border-radius:9px;gap:2px}.segments button{display:block;flex:1;height:29px;padding:0 4px;text-align:center;border-radius:7px;color:var(--muted)}.segments button:before{display:none}.segments button[aria-pressed=true]{background:var(--bg);color:var(--fg);box-shadow:0 1px 3px #0001}.body>.model-row{border-top:1px solid var(--line);padding-top:16px}.body>.primary{margin:14px 16px 16px;width:calc(100% - 32px);height:38px;background:var(--fg);color:var(--bg);border:0;border-radius:9px;justify-content:center}.primary:before{content:none}.primary:hover{background:var(--fg);opacity:.88}.body>.account-button{border-top:1px solid var(--line);border-radius:0;margin:0;padding:12px 16px;min-height:46px}.body>.hide-button{padding:8px 16px 14px;height:auto;border-radius:0;color:var(--muted)}.account-section{padding:16px}.account-info{padding:0;margin:0}.account-section .menu-primary{margin:0}.account-section .cancel-login{margin-top:6px;justify-content:center}.hint{margin:0 16px 12px;padding:10px;border-radius:8px;background:var(--soft);font-size:13px}.head .account-back{width:28px;min-height:28px;padding:5px;margin-left:-4px}.menu-row:disabled{opacity:.45;cursor:default}.menu-row svg{width:16px;height:16px}.account-button .menu-trailing{margin-left:auto}.sheet{border-radius:15px}.tip{font-size:12px;letter-spacing:0}`;
  launcherStyle.textContent+=`:host([data-theme=dark]) .panel{--bg:#171717;--soft:#242424}@media(prefers-color-scheme:dark){:host(:not([data-theme=light])) .panel{--bg:#171717;--soft:#242424}}`;
  launcherRoot.append(launcherStyle);
  const trigger=document.createElement('button');trigger.className='trigger';trigger.type='button';trigger.setAttribute('aria-label','Translate page');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','luna-panel');trigger.setAttribute('aria-describedby','luna-tip');
  // This static, authored SVG contains no page or model data.
  trigger.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 8 6 6m-7 0 6-6 2-4M2 4h12M7 2v2m7 18 5-11 5 11m-8-4h6" transform="translate(-1 0)"/></svg>';
  const tip=document.createElement('div');tip.id='luna-tip';tip.className='tip';tip.setAttribute('role','tooltip');
  const tipLabel=document.createElement('span');tipLabel.textContent='Translate page';const shortcut=document.createElement('kbd');shortcut.textContent='⌥ ⇧ T';tip.append(tipLabel,shortcut);
  const tipArrow=document.createElementNS('http://www.w3.org/2000/svg','svg');tipArrow.setAttribute('class','tip-arrow');tipArrow.setAttribute('viewBox','0 0 6 14');tipArrow.setAttribute('aria-hidden','true');
  const tipArrowPath=document.createElementNS('http://www.w3.org/2000/svg','path');tipArrowPath.setAttribute('d','M0 13.8284V0.17157C0 0.702003 0.210714 1.21071 0.585787 1.58578L4.58579 5.58578C5.36684 6.36683 5.36683 7.63316 4.58579 8.41421L0.585787 12.4142C0.210715 12.7893 0 13.298 0 13.8284Z');tipArrow.append(tipArrowPath);tip.append(tipArrow);
  const panel=document.createElement('section');panel.id='luna-panel';panel.className='panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Lunori');
  const head=document.createElement('div');head.className='head';const headTitle=document.createElement('span');headTitle.className='menu-title';headTitle.textContent='Lunori';head.append(headTitle);
  const close=document.createElement('button');close.className='close';close.textContent='×';close.setAttribute('aria-label','Close Lunori');head.append(close);
  const body=document.createElement('div');body.className='body';
  const row=document.createElement('div');row.className='row';const label=document.createElement('label');label.htmlFor='luna-language';label.textContent='Translate to';
  const language=document.createElement('select');language.id='luna-language';for(const [id,name] of [['ru','Russian'],['en','English'],['de','Deutsch'],['fr','Français'],['es','Español'],['zh','中文'],['ja','日本語']]){const option=document.createElement('option');option.value=id;option.textContent=name;language.append(option)}row.append(label,language);
  const segments=document.createElement('div');segments.className='segments';segments.setAttribute('role','group');segments.setAttribute('aria-label','Reading mode');
  let launcherMode=mode;
  for(const [value,label] of [['bilingual','Bilingual'],['translation','Translation only']]){const button=document.createElement('button');button.textContent=label;button.dataset.mode=value;button.setAttribute('aria-pressed',String(value===launcherMode));button.onclick=()=>{launcherMode=value;for(const item of segments.children)item.setAttribute('aria-pressed',String(item.dataset.mode===value));void chrome.storage?.local.set({mode:value})};segments.append(button)}
  const hint=document.createElement('p');hint.className='hint';hint.textContent='Keep fonts, links, and formatting.';
  const primary=document.createElement('button');primary.className='primary';primary.textContent='Translate page';
  const foot=document.createElement('div');foot.className='foot';foot.append(document.createTextNode('ChatGPT subscription'));const modelLabel=document.createElement('span');modelLabel.textContent='Luna';foot.append(modelLabel);
  const toolbar=document.createElement('div');toolbar.className='toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Lunori');
  const menuButton=document.createElement('button');menuButton.className='menu-toggle';menuButton.type='button';menuButton.tabIndex=-1;menuButton.setAttribute('aria-label','Lunori menu');menuButton.setAttribute('aria-haspopup','dialog');menuButton.setAttribute('aria-expanded','false');
  menuButton.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h12"/></svg>';
  toolbar.append(trigger,menuButton);
  const hideTarget=document.createElement('div');hideTarget.className='hide-target';hideTarget.hidden=true;hideTarget.setAttribute('aria-label','Hide toolbar');hideTarget.innerHTML='<span>Hide</span><b>×</b>';launcherRoot.append(hideTarget);
  const modelRow=document.createElement('label');modelRow.className='row model-row';modelRow.append(document.createTextNode('Model'));
  const modelSelect=document.createElement('select');modelSelect.setAttribute('aria-label','Model');modelRow.append(modelSelect);
  const speedRow=document.createElement('label');speedRow.className='row';speedRow.append(document.createTextNode('Speed'));
  const speedSelect=document.createElement('select');speedSelect.setAttribute('aria-label','Speed');speedRow.append(speedSelect);
  const accountButton=document.createElement('button');accountButton.className='menu-action account-button';accountButton.innerHTML='<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg><span>ChatGPT account</span>';const accountStatus=document.createElement('span');accountStatus.className='menu-trailing';accountButton.append(accountStatus);
  const hideButton=document.createElement('button');hideButton.className='menu-action hide-button';hideButton.textContent='Hide toolbar';hideButton.onclick=()=>hideLauncher(true);
  const accountSection=document.createElement('div');accountSection.className='account-section';accountSection.hidden=true;
  const accountBack=document.createElement('button');accountBack.className='menu-action account-back';accountBack.textContent='←';accountBack.setAttribute('aria-label','Back');accountBack.hidden=true;head.prepend(accountBack);
  const accountInfo=document.createElement('div');accountInfo.className='account-info';
  const loginButton=document.createElement('button');loginButton.className='menu-primary menu-secondary';loginButton.textContent='Connect ChatGPT';
  const authLink=document.createElement('a');authLink.className='menu-primary';authLink.textContent='Continue with ChatGPT ↗';authLink.target='_blank';authLink.rel='noopener noreferrer';authLink.hidden=true;
  const cancelLoginButton=document.createElement('button');cancelLoginButton.className='menu-action cancel-login';cancelLoginButton.textContent='Cancel sign-in';cancelLoginButton.hidden=true;
  const accountNote=document.createElement('p');accountNote.className='account-note';accountNote.textContent='Connecting another account changes Lunori only. Your desktop app stays signed in.';accountSection.append(accountInfo,loginButton,authLink,cancelLoginButton,accountNote);
  let accountState=null,availableModels=[],accountPoll=null;
  function fillSpeeds(selectedSpeed){
    const current=availableModels.find(m=>m.id===modelSelect.value);speedSelect.replaceChildren();
    for(const [id,label] of [['standard','Standard'],...(current?.fast?[['fast','Fast · higher usage']]:[])]){const o=document.createElement('option');o.value=id;o.textContent=label;speedSelect.append(o)}
    speedSelect.value=selectedSpeed==='fast'&&current?.fast?'fast':'standard';
  }
  function renderAccount(data){
    accountState=data.account||{connected:false};
    accountInfo.replaceChildren();
    const identity=document.createElement('div');identity.className='account-identity';
    const avatar=document.createElement('div');avatar.className='account-avatar';avatar.innerHTML='<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>';
    const info=document.createElement('div'),name=document.createElement('div'),caption=document.createElement('div');name.className='account-name';caption.className='account-caption';name.textContent=accountState.connected?accountState.email:'Connect ChatGPT';caption.textContent=accountState.connected?'ChatGPT':'Translation with your subscription';info.append(name,caption);identity.append(avatar,info);accountInfo.append(identity);
    if(accountState.connected){
      const details=document.createElement('div');details.className='account-details';
      const plan=({prolite:'Pro Lite',plus:'Plus',pro:'Pro',team:'Team',business:'Business',enterprise:'Enterprise'})[accountState.plan?.toLowerCase()]||accountState.plan||'ChatGPT';
      for(const [label,value,cls] of [['Status','Connected','connection'],['Plan',plan,'plan-badge'],['Sign-in',accountState.source==='linked'?'Lunori account':'On this Mac','account-value']]){const row=document.createElement('div');row.className='account-detail';const key=document.createElement('span'),val=document.createElement('span');key.textContent=label;val.textContent=value;val.className=cls;row.append(key,val);details.append(row)}
      accountInfo.append(details);
    }
    accountStatus.textContent=accountState.connected?'Connected  ›':'Connect  ›';
    loginButton.classList.toggle('menu-secondary',!!accountState.connected);
    loginButton.textContent=accountState.connected?'Connect another account':'Connect ChatGPT';
    if(data.login&&!data.login.pending){authLink.hidden=true;cancelLoginButton.hidden=true;loginButton.hidden=false;clearInterval(accountPoll);if(data.login.error)accountInfo.textContent=data.login.error;}
  }
  accountButton.onclick=()=>{headTitle.textContent='ChatGPT account';accountBack.hidden=false;for(const child of body.children)child.hidden=child!==accountSection;accountSection.hidden=false;positionMenu()};
  accountBack.onclick=()=>{headTitle.textContent='Lunori';accountBack.hidden=true;for(const child of body.children)child.hidden=child===accountSection;hint.hidden=!error;positionMenu()};
  loginButton.onclick=async()=>{
    loginButton.disabled=true;try{const result=await send({type:'login'});if(result.error)throw new Error(result.error);authLink.href=result.authUrl;authLink.hidden=false;cancelLoginButton.hidden=false;loginButton.hidden=true;
      clearInterval(accountPoll);accountPoll=setInterval(()=>void send({type:'catalog',refresh:true}).then(data=>{if(!data.error)renderAccount(data)}),2000);
    }catch(e){accountInfo.textContent=e.message}finally{loginButton.disabled=false;positionMenu()}
  };
  cancelLoginButton.onclick=async()=>{await send({type:'loginCancel'});authLink.hidden=true;cancelLoginButton.hidden=true;loginButton.hidden=false;clearInterval(accountPoll);positionMenu()};
  modelSelect.onchange=()=>{fillSpeeds(speedSelect.value);void chrome.storage?.local.set({model:modelSelect.value,speed:speedSelect.value})};
  speedSelect.onchange=()=>void chrome.storage?.local.set({speed:speedSelect.value});
  body.append(row,segments,modelRow,speedRow,primary,accountButton,hideButton,hint,accountSection);panel.append(head,body);launcherRoot.append(toolbar,tip,panel);document.documentElement.append(launcher);
  let openTimer=null,closeTimer=null,menuVersion=0,toggling=false,collapseTimer=null;
  let drag=null,suppressClick=false,position=null,positionTouched=false,snapAnimation=null,recoveryTimer=null;
  const buttonSize=32,edge=12;
  const clamp=(value,min,max)=>Math.min(Math.max(value,min),Math.max(min,max));
  function positionMenu(){
    const rect=launcher.getBoundingClientRect();
    const toRight=rect.left+buttonSize/2<innerWidth/2;
    panel.style.setProperty('--menu-origin',toRight?'left center':'right center');
    launcher.dataset.side=toRight?'right':'left';
    if(panel.hidden)return;
    const bounds=panel.getBoundingClientRect();
    const x=clamp(toRight?rect.right+10:rect.left-bounds.width-10,edge,innerWidth-bounds.width-edge);
    const y=clamp(rect.top+buttonSize/2-bounds.height/2,edge,innerHeight-bounds.height-edge);
    panel.style.left=(x-rect.left)+'px';panel.style.right='auto';
    panel.style.top=(y-rect.top)+'px';panel.style.transform='none';
  }
  function placeButton(x,y){
    const maxX=Math.max(edge,innerWidth-buttonSize-edge),maxY=Math.max(edge,innerHeight-Math.max(buttonSize,toolbar.getBoundingClientRect().height)-edge);
    x=clamp(x,edge,maxX);y=clamp(y,edge,maxY);
    launcher.style.setProperty('left',x+'px','important');launcher.style.setProperty('right','auto','important');
    launcher.style.setProperty('top',y+'px','important');
    position={x:(x-edge)/Math.max(1,maxX-edge),y:(y-edge)/Math.max(1,innerHeight-buttonSize-2*edge)};
    positionMenu();
  }
  function restorePosition(value){
    if(!value||!Number.isFinite(value.x)||!Number.isFinite(value.y))return;
    placeButton(edge+(value.x<.5?0:1)*Math.max(0,innerWidth-buttonSize-2*edge),edge+clamp(value.y,0,1)*Math.max(0,innerHeight-buttonSize-2*edge));
  }
  function savePosition(){positionTouched=true;void chrome.storage?.local.set({launcherPosition:position});}
  toolbar.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const rect=launcher.getBoundingClientRect();snapAnimation?.cancel();placeButton(rect.left,rect.top);suppressClick=false;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false,capture:event.target.closest('button')||toolbar};
    clearTimeout(collapseTimer);drag.capture.setPointerCapture?.(event.pointerId);
  });
  toolbar.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.moved&&Math.hypot(dx,dy)<4)return;
    if(!drag.moved)closeLauncher();
    drag.moved=true;positionTouched=true;suppressClick=true;toolbar.setAttribute('data-dragging','');
    event.preventDefault();hideTarget.hidden=false;
    let x=drag.left+dx;const right=innerWidth-buttonSize-edge;
    const magnet=distance=>{const t=clamp(distance/72,0,1);return 72*t*t*(2-t)};
    if(x<edge+72)x=edge+magnet(x-edge);
    else if(x>right-72)x=right-magnet(right-x);
    placeButton(x,drag.top+dy);
    hideTarget.toggleAttribute('data-over',Math.hypot(event.clientX-innerWidth/2,event.clientY-(innerHeight-48))<56);
  });
  function endDrag(event,cancel=false){
    if(!drag||event.pointerId!==drag.id)return;
    const finished=drag;drag=null;toolbar.removeAttribute('data-dragging');const dropToHide=hideTarget.hasAttribute('data-over');hideTarget.hidden=true;hideTarget.removeAttribute('data-over');
    if(finished.capture.hasPointerCapture?.(event.pointerId))finished.capture.releasePointerCapture(event.pointerId);
    if(finished.moved){
      if(cancel)placeButton(finished.left,finished.top);
      else if(dropToHide){placeButton(finished.left,finished.top);hideLauncher(true);}
      else {const r=launcher.getBoundingClientRect();const x=r.left+buttonSize/2<innerWidth/2?edge:innerWidth-buttonSize-edge;placeButton(x,r.top);savePosition();
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches)snapAnimation=launcher.animate?.(Array.from({length:25},(_,i)=>{const t=i/24,u=8*t;const progress=(1-(1+u)*Math.exp(-u))/(1-9*Math.exp(-8));return {transform:'translateX('+((r.left-x)*(1-progress))+'px)'}}),{duration:300,easing:'linear'});
      }
      toolbar.removeAttribute('data-expanded');menuButton.tabIndex=-1;
    }
  }
  toolbar.addEventListener('pointerup',event=>endDrag(event));
  toolbar.addEventListener('pointercancel',event=>endDrag(event,true));
  toolbar.addEventListener('lostpointercapture',event=>endDrag(event,true));
  window.addEventListener('resize',()=>{snapAnimation?.cancel();if(position)restorePosition(position);else {const r=launcher.getBoundingClientRect();placeButton(r.left,r.top);}});
  void chrome.storage?.local.get({launcherPosition:null}).then(settings=>{if(!positionTouched)restorePosition(settings.launcherPosition);});

  function updateLauncher(){
    trigger.setAttribute('aria-label',enabled?'Show original':'Translate page');
    trigger.setAttribute('aria-busy',String(working));
    trigger.dataset.active=String(enabled);menuButton.toggleAttribute('data-active',enabled);
    tipLabel.textContent=tip.dataset.for==='menu'?'Lunori menu':enabled?'Show original':'Translate page';
    primary.textContent=enabled?'Show original':'Translate page';
    hint.textContent=error;hint.hidden=!error;
  }
  function closeLauncher(){
    clearTimeout(openTimer);clearTimeout(closeTimer);menuVersion++;
    panel.hidden=true;trigger.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-expanded','false');
    trigger.setAttribute('data-tip-dismissed','');
  }
  async function openLauncher(focus=false){
    clearTimeout(openTimer);clearTimeout(closeTimer);
    const version=++menuVersion;headTitle.textContent='Lunori';accountBack.hidden=true;
    for(const child of body.children)child.hidden=child===accountSection;
    updateLauncher();expandToolbar();panel.hidden=false;positionMenu();
    trigger.setAttribute('aria-expanded','true');menuButton.setAttribute('aria-expanded','true');
    modelSelect.disabled=true;speedSelect.disabled=true;primary.disabled=!enabled;
    const [settings,data]=await Promise.all([chrome.storage?.local.get({target,mode,model,speed,theme:'system'}),send({type:'catalog'}).catch(e=>({error:e.message}))]);
    if(version!==menuVersion)return;
    language.value=settings?.target||target;launcherMode=settings?.mode||mode;
    availableModels=data.models||[];modelSelect.replaceChildren();
    for(const item of availableModels){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;modelSelect.append(option)}
    modelSelect.value=settings?.model||model;if(!modelSelect.value&&availableModels.length)modelSelect.value=availableModels[0].id;
    modelSelect.disabled=!availableModels.length;speedSelect.disabled=!availableModels.length;primary.disabled=!enabled&&!availableModels.length;
    fillSpeeds(settings?.speed||speed);renderAccount(data);if(data.error){accountInfo.textContent=data.error;}
    for(const child of body.children)child.hidden=child===accountSection;
    if(settings?.theme&&settings.theme!=='system')launcher.setAttribute('data-theme',settings.theme);
    for(const button of segments.children)button.setAttribute('aria-pressed',String(button.dataset.mode===launcherMode));
    updateLauncher();expandToolbar();panel.hidden=false;positionMenu();trigger.setAttribute('aria-expanded','true');menuButton.setAttribute('aria-expanded','true');
    if(data.error){hint.textContent=data.error;hint.hidden=false;}
    if(focus)language.focus();
  }
  async function toggleTranslation(fromMenu=false){
    if(toggling)return;toggling=true;closeLauncher();
    try{
      if(enabled){stop();return;}
      const settings=fromMenu?{target:language.value,mode:launcherMode,model:modelSelect.value,speed:speedSelect.value}:await chrome.storage?.local.get({target,mode,model,speed});
      const options={target:settings?.target||target,mode:settings?.mode||mode,model:settings?.model||model,speed:settings?.speed||speed};
      void chrome.storage?.local.set(options);start(options);
    }finally{toggling=false;updateLauncher();}
  }
  function keepMenu(){clearTimeout(closeTimer);}
  function leaveMenu(){
    if(!panel.hidden)return;
    clearTimeout(openTimer);menuVersion++;
    closeTimer=setTimeout(()=>{if(!panel.contains(launcherRoot.activeElement))closeLauncher();},240);
  }
  function expandToolbar(){
    clearTimeout(collapseTimer);toolbar.setAttribute('data-expanded','');menuButton.tabIndex=0;
    const r=launcher.getBoundingClientRect();if(r.top>innerHeight-76)placeButton(r.left,innerHeight-76);
  }
  toolbar.addEventListener('pointerenter',event=>{if(event.pointerType==='touch'||drag)return;expandToolbar();keepMenu()});
  toolbar.addEventListener('pointerleave',()=>{
    leaveMenu();collapseTimer=setTimeout(()=>{if(panel.hidden&&!drag&&!toolbar.querySelector(':focus-visible')){toolbar.removeAttribute('data-expanded');menuButton.tabIndex=-1;}},350);
  });
  trigger.addEventListener('pointerenter',()=>{tip.dataset.for='action';tip.style.top='16px';shortcut.hidden=false;updateLauncher()});
  menuButton.addEventListener('pointerenter',()=>{tip.dataset.for='menu';tip.style.top='48px';shortcut.hidden=true;updateLauncher()});
  trigger.addEventListener('focus',expandToolbar);
  panel.addEventListener('pointerenter',()=>{keepMenu();clearTimeout(collapseTimer)});
  panel.addEventListener('pointerleave',leaveMenu);
  menuButton.onclick=event=>{if(suppressClick){suppressClick=false;event.preventDefault();return;}if(panel.hidden)void openLauncher(event.detail===0);else closeLauncher()};
  // Primary click translates; secondary click or ArrowDown gives keyboard/touch access to settings.
  trigger.onclick=event=>{if(suppressClick){suppressClick=false;event.preventDefault();return;}void toggleTranslation();};
  trigger.oncontextmenu=event=>{event.preventDefault();void openLauncher(true)};
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();void openLauncher(true)}});
  close.onclick=()=>{closeLauncher();trigger.focus()};
  primary.onclick=()=>{void toggleTranslation(true);trigger.focus()};
  language.onchange=()=>void chrome.storage?.local.set({target:language.value});
  launcherRoot.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeLauncher();trigger.focus()}});
  launcherRoot.addEventListener('focusout',()=>{queueMicrotask(()=>{if(!launcherRoot.activeElement)leaveMenu()})});
  document.addEventListener('pointerdown',e=>{if(!e.composedPath().includes(launcher))closeLauncher()},{passive:true});
  void chrome.storage?.local.get({theme:'system'}).then(settings=>{if(settings.theme!=='system')launcher.setAttribute('data-theme',settings.theme)});
  const recovery=document.createElement('div');recovery.setAttribute('data-luna-owned','');recovery.setAttribute('data-luna-recovery','');recovery.hidden=true;
  recovery.style.cssText='position:fixed!important;bottom:20px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483647!important;';
  const recoveryRoot=recovery.attachShadow({mode:'closed'}),recoveryStyle=document.createElement('style');
  recoveryStyle.textContent=':host{all:initial}:host([hidden]){display:none!important}div{display:flex;align-items:center;gap:14px;max-width:calc(100vw - 24px);padding:10px 14px;border-radius:12px;background:#262626;color:#eee;box-shadow:0 6px 24px #0003;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}button{border:0;background:#ffffff18;color:inherit;border-radius:7px;padding:7px 10px;font:inherit;cursor:pointer;white-space:nowrap}button:hover{background:#ffffff28}button:focus-visible{outline:2px solid white}';
  const recoveryBody=document.createElement('div');recoveryBody.setAttribute('role','status');
  const recoveryText=document.createElement('span');recoveryText.textContent='Toolbar hidden · ⌥⇧H';
  const undoHide=document.createElement('button');undoHide.textContent='Undo';undoHide.onclick=()=>hideLauncher(false);
  recoveryBody.append(recoveryText,undoHide);recoveryRoot.append(recoveryStyle,recoveryBody);document.documentElement.append(recovery);
  function hideLauncher(hidden){
    closeLauncher();clearTimeout(recoveryTimer);snapAnimation?.cancel();
    toolbar.removeAttribute('data-expanded');menuButton.tabIndex=-1;
    launcher.style.setProperty('display',hidden?'none':'block','important');
    recovery.hidden=!hidden;if(hidden)recoveryTimer=setTimeout(()=>{recovery.hidden=true},12000);
    void chrome.storage?.local.set({launcherHidden:hidden});
  }
  void chrome.storage?.local.get({launcherHidden:false}).then(settings=>{if(settings.launcherHidden)launcher.style.setProperty('display','none','important')});
  document.addEventListener('keydown',event=>{if(event.altKey&&event.shiftKey&&event.code==='KeyH'&&!event.repeat&&!event.target.closest?.('input,textarea,[contenteditable=true]')){event.preventDefault();hideLauncher(launcher.style.display!=='none')}});
  // Preview theme controls and real extension preferences share the same tokens.
  chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.theme){const value=changes.theme.newValue;if(value==='system')launcher.removeAttribute('data-theme');else launcher.setAttribute('data-theme',value)}});
  window.addEventListener('pagehide',()=>{clearTimeout(openTimer);clearTimeout(closeTimer);clearTimeout(collapseTimer);clearInterval(accountPoll);snapAnimation?.cancel();clearTimeout(recoveryTimer);recovery.remove();launcher.remove()},{once:true});

  window.addEventListener('pagehide',stop,{once:true});
})();
