import {createInterface} from 'node:readline';
import {catalog,startLogin,cancelLogin,closeAccount} from './account.mjs';
import {translate,LANGUAGES} from './translator.mjs';
const active=new Map();
const schema=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true};
const tools=[
 {name:'translate_text',description:'Translate user-provided text through the public Responses API with your ChatGPT plan. Uses the account’s shared limits. Preserves numbered inline-format markers.',inputSchema:schema({text:{type:'string',minLength:1,maxLength:6000},target:{type:'string',enum:Object.keys(LANGUAGES)},model:{type:'string'},speed:{type:'string',enum:['standard','fast']}},['text','target']),annotations:{...annotations,idempotentHint:false}},
 {name:'list_models',description:'List models and Fast availability for the connected ChatGPT account.',inputSchema:schema(),annotations},
 {name:'account_status',description:'Read connection status, email, plan, and sign-in source. Never returns credentials.',inputSchema:schema(),annotations},
 {name:'connect_account',description:'Start official ChatGPT sign-in only when the user explicitly asks to connect an account. Returns a sign-in URL.',inputSchema:schema(),annotations:{...annotations,readOnlyHint:false,idempotentHint:false}},
 {name:'cancel_sign_in',description:'Cancel the current pending sign-in.',inputSchema:schema(),annotations:{...annotations,readOnlyHint:false}}
];
const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
async function handle(message){
 const {id,method,params={}}=message;
 if(id===undefined){if(method==='notifications/cancelled')active.get(params.requestId)?.abort();return}
 const result=value=>send({jsonrpc:'2.0',id,result:value});
 if(method==='initialize')return result({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'lunori',version:'0.6.0'}});
 if(method==='ping')return result({});
 if(method==='tools/list')return result({tools});
 if(method!=='tools/call')return send({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
 try{
  let value;const args=params.arguments||{};
  if(params.name==='translate_text'){
   if(active.size>=3)throw new Error('Three translations are already running. Retry after one completes.');
   const controller=new AbortController();active.set(id,controller);
   try{const response=await translate({target:args.target,segments:[{id:'text',text:args.text}],model:args.model,speed:args.speed},{signal:controller.signal});value={text:response.segments[0].text,model:response.model,speed:response.speed}}finally{active.delete(id)}
  }else if(params.name==='list_models')value={models:(await catalog()).models};
  else if(params.name==='account_status')value=(await catalog({refresh:true})).account;
  else if(params.name==='connect_account')value=await startLogin();
  else if(params.name==='cancel_sign_in')value=await cancelLogin();
  else throw new Error('Unknown tool');
  result({content:[{type:'text',text:JSON.stringify(value)}]});
 }catch(error){result({isError:true,content:[{type:'text',text:error.message||'Request failed'}]})}
}
const input=createInterface({input:process.stdin});
input.on('line',line=>{if(line.length>65536){send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Request too large'}});return}let message;try{message=JSON.parse(line)}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return}if(!message||typeof message!=='object'){send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}});return}void handle(message)});
function shutdown(){for(const controller of active.values())controller.abort();closeAccount();process.exit(0)}
input.on('close',shutdown);process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
