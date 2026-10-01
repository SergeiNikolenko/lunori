import {useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Languages,Loader2,MoreHorizontal,Sun,Moon,Monitor,RotateCcw,UserRound,ArrowLeft,PanelRight,Trash2,ExternalLink,ChevronRight} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs'
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select'
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuSeparator,DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
type Prefs={launcherHidden:boolean;target:string;mode:string;model:string;speed:string;theme:'light'|'dark'|'system'}
type Model={id:string;name:string;fast:boolean}
type Catalog={models:Model[];account:{connected:boolean;sharing?:boolean;email?:string;plan?:string;source?:string};login?:{pending:boolean;error?:string;authUrl?:string};modelError?:string;error?:string}
type Page={enabled:boolean;done:number;working:boolean;error?:string}
const initial:Prefs={launcherHidden:false,target:'ru',mode:'translation',model:'gpt-6-luna',speed:'standard',theme:'system'}
const languages=[['ru','Russian'],['en','English'],['de','Deutsch'],['fr','Français'],['es','Español'],['zh','中文'],['ja','日本語']]
function App(){
 const [prefs,setPrefs]=useState(initial),[page,setPage]=useState<Page>({enabled:false,done:0,working:false})
 const [catalog,setCatalog]=useState<Catalog|null>(null),[tab,setTab]=useState<chrome.tabs.Tab|null>(null)
 const [busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[accountView,setAccountView]=useState(false)
 const [loginUrl,setLoginUrl]=useState(''),[loggingIn,setLoggingIn]=useState(false)
 async function refreshCatalog(refresh=false){const data=await chrome.runtime.sendMessage({type:'catalog',refresh});if(data.error)throw new Error(data.error);setCatalog(data);if(data.modelError)setFailure(data.modelError);return data as Catalog}
 useEffect(()=>{
  let live=true
  Promise.all([chrome.storage.local.get(initial),chrome.tabs.query({active:true,currentWindow:true}),chrome.runtime.sendMessage({type:'catalog'})]).then(([saved,tabs,data])=>{
   if(!live)return;setPrefs(saved as Prefs);setTab(tabs[0]||null);if(data.error)setFailure(data.error);else {setCatalog(data);if(data.modelError)setFailure(data.modelError)}
   const t=tabs[0];if(t?.id&&/^https?:/.test(t.url||''))void chrome.runtime.sendMessage({type:'action',tabId:t.id,action:'state'}).then(result=>{if(live&&!result.error)setPage(result)})
  }).catch(()=>{if(live)setFailure('The local companion is unavailable')})
  const listener=(changes:Record<string,chrome.storage.StorageChange>,area:string)=>{if(area==='local')setPrefs(prev=>{const next={...prev};for(const key of Object.keys(initial) as (keyof Prefs)[])if(changes[key])Object.assign(next,{[key]:changes[key].newValue});return next})}
  chrome.storage.onChanged.addListener(listener);return()=>{live=false;chrome.storage.onChanged.removeListener?.(listener)}
 },[])
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');const apply=()=>{const dark=prefs.theme==='dark'||prefs.theme==='system'&&media.matches;document.documentElement.classList.toggle('dark',dark);if(parent!==window)parent.postMessage({type:'luna-theme',dark},location.origin)};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply)},[prefs.theme])
 useEffect(()=>{const receive=(e:MessageEvent)=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==='preview-theme')void save({theme:e.data.theme})};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[prefs])
 useEffect(()=>{if(!tab?.id)return;let live=true;const refresh=()=>chrome.tabs.sendMessage(tab.id!,{type:'state'}).then(result=>{if(live&&!result.error)setPage(result)}).catch(()=>{});void refresh();const t=setInterval(refresh,1000);return()=>{live=false;clearInterval(t)}},[tab?.id])
 useEffect(()=>{if(!loggingIn)return;let live=true;const timer=setInterval(()=>void refreshCatalog(true).then(data=>{if(live&&data.login&&!data.login.pending){setLoggingIn(false);setLoginUrl('');setFailure(data.login.error||'')}}).catch(e=>{if(live)setFailure(e.message)}),2000);return()=>{live=false;clearInterval(timer)}},[loggingIn])
 async function save(change:Partial<Prefs>){setPrefs(prev=>({...prev,...change}));await chrome.storage.local.set(change)}
 async function act(action:'start'|'stop'|'showLauncher'){
  if(!tab?.id)return;setBusy(true);setFailure('')
  try{const result=await chrome.runtime.sendMessage({type:'action',tabId:tab.id,action,options:prefs});if(result.error)throw new Error(result.error);if(action==='showLauncher')void save({launcherHidden:false});if(action!=='showLauncher')setPage(prev=>({...prev,...result}))}catch(e){setFailure(e instanceof Error?e.message:'This action is unavailable')}finally{setBusy(false)}
 }
 async function login(){setBusy(true);setFailure('');try{const result=await chrome.runtime.sendMessage({type:'login',newProfile:!!catalog?.account.sharing});if(result.error)throw new Error(result.error);setLoginUrl(result.authUrl);setLoggingIn(true)}catch(e){setFailure(e instanceof Error?e.message:'Could not start sign-in')}finally{setBusy(false)}}
 useEffect(()=>{if(!catalog?.models.length)return;const model=catalog.models.some(m=>m.id===prefs.model)?prefs.model:(catalog.models.find(m=>/luna/i.test(m.id))||catalog.models[0]).id;if(model!==prefs.model||prefs.speed!=='standard')void save({model,speed:'standard'})},[catalog,prefs.model,prefs.speed])
 useEffect(()=>{if(catalog?.login?.pending){setLoggingIn(true);setLoginUrl(catalog.login.authUrl||'')}},[catalog?.login?.pending,catalog?.login?.authUrl])
 const selected=catalog?.models.find(m=>m.id===prefs.model)
 const disabled=busy||!catalog?.account.sharing||!selected||!tab?.id||!/^https?:/.test(tab.url||'')
 const row=(label:string,value:string,items:string[][],change:(value:string)=>void)=><div className="flex min-h-9 items-center justify-between gap-3"><span className="shrink-0">{label}</span><Select value={value} onValueChange={change} disabled={!items.length}><SelectTrigger aria-label={label} className="h-9 w-[185px] bg-background"><SelectValue placeholder="Unavailable"/></SelectTrigger><SelectContent position="popper" align="end">{items.map(([id,name])=><SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>
 const account=catalog?.account
 const plan=({prolite:'Pro Lite',plus:'Plus',pro:'Pro',team:'Team',business:'Business',enterprise:'Enterprise'} as Record<string,string>)[account?.plan?.toLowerCase()||'']||account?.plan||'ChatGPT'
 return <div className="luna-ui flex flex-col">
  <header className="menu-heading">
   {accountView?<Button variant="ghost" size="icon" className="size-8 -ml-1" aria-label="Back" onClick={()=>setAccountView(false)}><ArrowLeft className="size-4"/></Button>:<Languages className="size-[18px]"/>}
   <span className="menu-title">{accountView?'ChatGPT account':'Lunori'}</span>
   <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Settings"><MoreHorizontal className="size-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><DropdownMenuRadioGroup value={prefs.theme} onValueChange={value=>void save({theme:value as Prefs['theme']})}><DropdownMenuRadioItem value="light"><Sun className="mr-2 size-4"/>Light</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark"><Moon className="mr-2 size-4"/>Dark</DropdownMenuRadioItem><DropdownMenuRadioItem value="system"><Monitor className="mr-2 size-4"/>System</DropdownMenuRadioItem></DropdownMenuRadioGroup><DropdownMenuSeparator/><DropdownMenuItem onSelect={()=>void act('showLauncher')}><PanelRight className="size-4"/>Show toolbar</DropdownMenuItem><DropdownMenuItem onSelect={()=>void chrome.runtime.sendMessage({type:'clearCache'})}><Trash2 className="size-4"/>Clear cache</DropdownMenuItem><DropdownMenuItem onSelect={()=>void refreshCatalog(true).catch(e=>setFailure(e.message))}><RotateCcw className="size-4"/>Refresh models and account</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
  </header>
  {accountView?<main className="p-4">
   <div className="account-identity"><div className="account-avatar"><UserRound/></div><div className="min-w-0"><div className="account-name">{account?.connected?account.email:'Connect ChatGPT'}</div><div className="account-caption">{account?.sharing?'Using ChatGPT plan':'Translation with your subscription'}</div></div></div>
   {account?.connected&&<div className="account-details">
    <div className="account-detail"><span>Status</span><span className="connection">{account.sharing?'Connected':'Plan permission needed'}</span></div>
    <div className="account-detail"><span>Plan</span><span className="plan-badge">{plan}</span></div>
    <div className="account-detail"><span>Sign-in</span><span className="account-value">Sign in with ChatGPT</span></div>
   </div>}
   {!loggingIn&&<Button variant={account?.connected?'outline':'default'} className="h-[38px] w-full rounded-[9px] text-[13px] shadow-none" disabled={busy} onClick={()=>void login()}>{busy?<Loader2 className="size-4 animate-spin"/>:<UserRound className="size-4"/>}{account?.sharing?'Connect another account':'Continue with ChatGPT'}</Button>}
   {loginUrl&&<Button asChild className="h-[38px] w-full rounded-[9px] text-[13px]"><a href={loginUrl} target="_blank" rel="noopener noreferrer">Continue sign-in<ExternalLink className="size-4"/></a></Button>}
   {loggingIn&&<Button variant="ghost" className="mt-2 w-full text-[13px]" onClick={async()=>{const result=await chrome.runtime.sendMessage({type:'loginCancel'});if(result.error){setFailure(result.error);return}setLoggingIn(false);setLoginUrl('')}}>Cancel sign-in</Button>}
   <Button asChild variant="ghost" className="mt-2 w-full text-[13px]"><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">Manage usage<ExternalLink className="size-4"/></a></Button>
   <p className="account-note">Lunori uses your ChatGPT plan limits. Your ChatGPT conversations stay private.</p>
  </main>:<main>
   <section className="menu-group">
    {row('Translate to',prefs.target,languages,value=>void save({target:value}))}
    <Tabs value={prefs.mode} onValueChange={value=>void save({mode:value})}><TabsList className="grid h-9 w-full grid-cols-2 rounded-[9px]"><TabsTrigger className="rounded-[7px] text-[13px]" value="bilingual">Bilingual</TabsTrigger><TabsTrigger className="rounded-[7px] text-[13px]" value="translation">Translation only</TabsTrigger></TabsList></Tabs>
   </section>
   <section className="menu-group">
    {row('Model',prefs.model,(catalog?.models||[]).map(m=>[m.id,m.name]),value=>void save({model:value,speed:catalog?.models.find(m=>m.id===value)?.fast?prefs.speed:'standard'}))}
    {row('Speed',prefs.speed,[['standard','Standard'],...(selected?.fast?[['fast','Fast · higher usage']]:[])],value=>void save({speed:value}))}
    <Button className="h-[38px] w-full gap-2 rounded-[9px] text-[13px]" disabled={disabled||page.working} onClick={()=>void act('start')}>{page.working?<Loader2 className="size-4 animate-spin"/>:<Languages className="size-4"/>}{page.working?'Translating…':page.enabled?'Apply changes':'Translate page'}</Button>
    {page.enabled&&<Button variant="outline" className="h-[38px] w-full gap-2 rounded-[9px] text-[13px] shadow-none" disabled={busy} onClick={()=>void act('stop')}><RotateCcw className="size-4"/>Show original</Button>}
   </section>
   <section className="border-t p-2">
    <button className="menu-action" onClick={()=>setAccountView(true)}><UserRound className="menu-icon"/><span>{account?.sharing?'Using ChatGPT plan':'ChatGPT account'}</span><span className="menu-trailing">{account?.connected?<span className="connection">Connected</span>:'Connect'}<ChevronRight className="size-3.5"/></span></button>
    {prefs.launcherHidden&&<button className="menu-action" onClick={()=>void act('showLauncher')}><PanelRight className="menu-icon"/>Show toolbar</button>}
   </section>
  </main>}
  {(failure||page.error)&&<p role="alert" className="mx-4 mb-4 rounded-lg bg-destructive/5 p-3 text-[13px] text-destructive">{failure||page.error}</p>}
 </div>
}
createRoot(document.getElementById('root')!).render(<App/>);
