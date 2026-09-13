import {test} from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{JSDOM}from'jsdom';
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function page({delayed=false}={}){
 const dom=new JSDOM('<!doctype html><html><body><nav><p>Never translate navigation</p></nav><article><h1>A beautiful heading</h1><p id="p">Read <a href="https://example.com/paper" onclick="window.bad=true">the study</a> with <strong>care</strong>.</p><p id="code">Run <code>foo()</code> and read the answer.</p></article><input value="private"><div contenteditable="true"><p>Private draft text</p></div></body></html>',{url:'https://example.com',runScripts:'outside-only'});
 const w=dom.window,requests=[],roots=new WeakMap();let listener;const releases=[];
 const attach=w.Element.prototype.attachShadow;w.Element.prototype.attachShadow=function(options){const root=attach.call(this,options);roots.set(this,root);return root;};
 w.HTMLElement.prototype.getClientRects=function(){return [{width:100,height:30}];};
 w.matchMedia=()=>({matches:false});
 w.IntersectionObserver=class{constructor(cb){this.cb=cb;}observe(el){queueMicrotask(()=>this.cb([{target:el,isIntersecting:true}]));}unobserve(){}disconnect(){}};
 w.chrome={runtime:{onMessage:{addListener(fn){listener=fn;}},async sendMessage(message){if(message.type!=='translate')return {ok:true};requests.push(message);if(delayed)await new Promise(r=>releases.push(r));return{segments:message.segments.map(s=>({id:s.id,text:s.text.replace('Read','Читайте').replace('the study','исследование').replace('care','внимание').replace('A beautiful heading','Красивый заголовок')}))};}}};
 w.eval(source);
 const action=(type,mode='bilingual')=>new Promise(resolve=>listener({type,target:'ru',mode},{},resolve));
 return {w,requests,action,recovery:roots.get(w.document.querySelector('[data-luna-recovery]')),launcher:roots.get(w.document.querySelector('[data-luna-launcher]')),release:()=>releases.splice(0).forEach(r=>r()),close:()=>dom.window.close()};
}
test('bilingual preserves links, ignores controls, adds dynamic content, restores exact nodes',async()=>{
 const p=page();const original=p.w.document.querySelector('#p'),link=original.querySelector('a');let clicks=0;link.addEventListener('test-click',()=>clicks++);
 await p.action('start');await sleep(450);
 assert.match(original.textContent,/Читайте/);assert.equal(original.querySelectorAll('a').length,2);
 const translated=original.querySelector('[data-luna-owned] a');assert.equal(translated.href,link.href);assert.equal(translated.getAttribute('onclick'),null);
 assert.ok(!JSON.stringify(p.requests).includes('Private draft'));assert.ok(!JSON.stringify(p.requests).includes('Never translate'));
 const next=p.w.document.createElement('p');next.textContent='A newly loaded article paragraph';p.w.document.querySelector('article').append(next);await sleep(650);
 assert.ok(p.requests.some(r=>r.segments.some(s=>s.text.includes('newly loaded'))));
 await p.action('stop');assert.equal(original.querySelector('a'),link);link.dispatchEvent(new p.w.Event('test-click'));assert.equal(clicks,1);assert.equal(original.textContent,'Read the study with care.');assert.equal(p.w.document.querySelectorAll('[data-luna-owned]:not([data-luna-launcher]):not([data-luna-recovery])').length,0);p.close();
});
test('translation-only restores original node identity and code',async()=>{
 const p=page();const original=p.w.document.querySelector('#p'),link=original.querySelector('a');
 await p.action('start','translation');await sleep(450);assert.match(original.textContent,/Читайте/);assert.equal(original.querySelectorAll('a').length,1);
 assert.ok(p.w.document.querySelector('#code').textContent.includes('foo()'));
 await p.action('stop');assert.equal(original.querySelector('a'),link);assert.equal(original.textContent,'Read the study with care.');p.close();
});
test('late model response cannot modify a restored page',async()=>{
 const p=page({delayed:true});await p.action('start');await sleep(250);assert.equal(p.requests.length,1);await p.action('stop');p.release();await sleep(50);assert.equal(p.w.document.querySelectorAll('[data-luna-owned]:not([data-luna-launcher]):not([data-luna-recovery])').length,0);assert.equal(p.w.document.querySelector('#p').textContent,'Read the study with care.');p.close();
});

test('toolbar hover reveals menu control without translating and action translates in place',async()=>{
 const p=page({delayed:true});try{
  const trigger=p.launcher.querySelector('.trigger'),panel=p.launcher.querySelector('.panel');
  p.launcher.querySelector('.toolbar').dispatchEvent(new p.w.Event('pointerenter'));
  assert.ok(p.launcher.querySelector('.toolbar').hasAttribute('data-expanded'));assert.equal(panel.hidden,true);
  p.launcher.querySelector('.menu-toggle').click();await sleep(20);
  assert.equal(panel.hidden,false);assert.equal(p.requests.length,0);
  trigger.click();await sleep(240);
  assert.equal(panel.hidden,true);assert.equal(p.requests.length,1);
  const paragraph=p.w.document.querySelector('#p');
  assert.ok(paragraph.querySelector('[data-luna-progress][data-active]'));
  assert.equal(paragraph.textContent,'Read the study with care.');
  p.release();await sleep(40);
  assert.match(paragraph.textContent,/Читайте/);assert.ok(!paragraph.textContent.includes('Read'));
  assert.equal(paragraph.querySelector('[data-luna-progress]'),null);
  trigger.click();await sleep(10);
  assert.equal(paragraph.textContent,'Read the study with care.');
  assert.equal(p.w.document.querySelectorAll('[data-luna-progress]').length,0);
 }finally{p.close();}
});
test('leaving launcher before hover delay cannot reopen its menu',async()=>{
 const p=page();try{
  const toolbar=p.launcher.querySelector('.toolbar');
  toolbar.dispatchEvent(new p.w.Event('pointerenter'));toolbar.dispatchEvent(new p.w.Event('pointerleave'));
  await sleep(300);assert.equal(p.launcher.querySelector('.panel').hidden,true);assert.equal(p.requests.length,0);
 }finally{p.close();}
});

test('drag clamps and saves position without translating; the next click still works',async()=>{
 const p=page();try{
  const host=p.w.document.querySelector('[data-luna-launcher]');host.getBoundingClientRect=()=>({left:parseFloat(host.style.left)||0,top:parseFloat(host.style.top)||0,right:(parseFloat(host.style.left)||0)+32,height:32,width:32});
  let saved=null;p.w.chrome.storage={local:{async set(value){saved=value},async get(){return {target:'ru',mode:'translation'}}}};
  const trigger=p.launcher.querySelector('.trigger');
  const pointer=(type,x,y)=>{const event=new p.w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true});Object.defineProperty(event,'pointerId',{value:1});trigger.dispatchEvent(event);};
  pointer('pointerdown',10,10);pointer('pointermove',-100,10000);pointer('pointerup',-100,10000);trigger.click();
  await sleep(240);assert.equal(p.requests.length,0);assert.equal(saved.launcherPosition.x,0);assert.equal(saved.launcherPosition.y,1);
  assert.equal(host.style.left,'12px');assert.equal(parseFloat(host.style.top),p.w.innerHeight-44);
  pointer('pointerdown',20,20);pointer('pointerup',20,20);trigger.click();await sleep(240);
  assert.equal(p.requests.length,1);
 }finally{p.close();}
});

test('dropping on hide target hides without translating and can be restored',async()=>{
 const p=page();try{
  const trigger=p.launcher.querySelector('.trigger'),host=p.w.document.querySelector('[data-luna-launcher]');let saved;
  p.w.chrome.storage={local:{async set(value){saved=value}}};
  const pointer=(type,x,y)=>{const event=new p.w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true});Object.defineProperty(event,'pointerId',{value:1});trigger.dispatchEvent(event)};
  pointer('pointerdown',20,20);pointer('pointermove',p.w.innerWidth/2,p.w.innerHeight-48);pointer('pointerup',p.w.innerWidth/2,p.w.innerHeight-48);trigger.click();
  await sleep(220);assert.equal(host.style.display,'none');assert.equal(saved.launcherHidden,true);assert.equal(p.requests.length,0);
  await p.action('showLauncher');assert.equal(host.style.display,'block');assert.equal(saved.launcherHidden,false);
 }finally{p.close()}
});

test('menu button drags without opening, while a stationary click toggles menu',async()=>{
 const p=page();try{
  const host=p.w.document.querySelector('[data-luna-launcher]'),menu=p.launcher.querySelector('.menu-toggle'),panel=p.launcher.querySelector('.panel');
  host.getBoundingClientRect=()=>({left:parseFloat(host.style.left)||12,top:parseFloat(host.style.top)||100,right:(parseFloat(host.style.left)||12)+32,height:32,width:32});
  const pointer=(type,x,y)=>{const e=new p.w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true});Object.defineProperty(e,'pointerId',{value:1});menu.dispatchEvent(e)};
  pointer('pointerdown',28,140);pointer('pointermove',700,240);pointer('pointerup',700,240);menu.click();await sleep(20);
  assert.equal(panel.hidden,true);assert.equal(p.requests.length,0);assert.equal(host.style.left,(p.w.innerWidth-44)+'px');
  pointer('pointerdown',700,240);pointer('pointerup',700,240);menu.click();await sleep(20);assert.equal(panel.hidden,false);
  pointer('pointerdown',700,240);pointer('pointerup',700,240);menu.click();await sleep(20);assert.equal(panel.hidden,true);
 }finally{p.close()}
});

test('translation runs three bounded batches concurrently and ignores all late results after stop',async()=>{
 const p=page({delayed:true});try{
  for(let i=0;i<20;i++){const el=p.w.document.createElement('p');el.textContent='Read this additional paragraph number '+i;p.w.document.querySelector('article').append(el)}
  await p.action('start','translation');await sleep(150);
  assert.equal(p.requests.length,3);assert.ok(p.requests.every(r=>r.segments.length===6));
  assert.equal(p.w.document.querySelectorAll('[data-luna-progress][data-active]').length,18);
  await p.action('stop');p.release();await sleep(80);
  assert.equal(p.requests.length,3);assert.equal(p.w.document.querySelectorAll('[data-luna-progress]').length,0);
  assert.match(p.w.document.querySelector('#p').textContent,/^Read/);
 }finally{p.close()}
});

test('hide shows a discoverable undo and the open menu survives pointer leave',async()=>{
 const p=page();try{
  const menu=p.launcher.querySelector('.menu-toggle'),panel=p.launcher.querySelector('.panel');
  menu.click();await sleep(20);assert.equal(panel.hidden,false);
  panel.dispatchEvent(new p.w.Event('pointerleave'));await sleep(280);assert.equal(panel.hidden,false);
  [...p.launcher.querySelectorAll('button')].find(b=>b.textContent==='Hide toolbar').click();
  const toast=p.w.document.querySelector('[data-luna-recovery]');assert.equal(toast.hidden,false);
  p.recovery.querySelector('button').click();assert.equal(toast.hidden,true);
  assert.equal(p.w.document.querySelector('[data-luna-launcher]').style.display,'block');
 }finally{p.close()}
});
