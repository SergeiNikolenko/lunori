import {catalog,startLogin,cancelLogin,closeAccount} from './account.mjs';
import { translate, MODEL } from './translator.mjs';
let buffer=Buffer.alloc(0), active=new Map();
function send(message){const body=Buffer.from(JSON.stringify(message));const header=Buffer.alloc(4);header.writeUInt32LE(body.length);process.stdout.write(Buffer.concat([header,body]));}
async function receive(message){
  if(typeof message?.id!=='string'||message.id.length>100)return;
  if(message.type==='ping')return send({id:message.id,ok:true,model:MODEL});
  if(['catalog','login','loginCancel'].includes(message.type)){try{return send({id:message.id,...await (message.type==='catalog'?catalog({refresh:!!message.refresh}):message.type==='login'?startLogin({newProfile:!!message.newProfile}):cancelLogin())})}catch(error){return send({id:message.id,error:error.message})}}
  if(message.type==='cancel'){active.get(message.requestId)?.abort();return;}
  if(message.type!=='translate')return send({id:message.id,error:'Unknown request'});
  if(active.size>=3)return send({id:message.id,error:'Translator is busy'});
  const controller=new AbortController();active.set(message.id,controller);
  try{send({id:message.id,ok:true,...await translate(message,{signal:controller.signal})});}
  catch(error){send({id:message.id,error:error.message});}
  finally{active.delete(message.id);}
}
process.stdin.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  while(buffer.length>=4){const length=buffer.readUInt32LE();if(length>65536)process.exit(1);if(buffer.length<length+4)break;
    const body=buffer.subarray(4,length+4);buffer=buffer.subarray(length+4);
    try{void receive(JSON.parse(body));}catch{process.exit(1);}
  }
});
process.stdin.on('end',()=>{for(const controller of active.values())controller.abort();closeAccount();process.exit(0);});
process.on('SIGTERM',()=>{for(const controller of active.values())controller.abort();closeAccount();process.exit(0);});
