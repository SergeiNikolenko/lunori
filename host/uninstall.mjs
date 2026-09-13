import {readFile,unlink,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
const destination=homedir()+'/Library/Application Support/Lunori/Companion';
const launchers=[destination+'/launch',fileURLToPath(new URL('./launch',import.meta.url))];
for(const browser of ['Google/Chrome','Arc/User Data','Microsoft Edge','BraveSoftware/Brave-Browser']){
 const path=homedir()+'/Library/Application Support/'+browser+'/NativeMessagingHosts/com.lunatranslate.bridge.json';
 try{const data=JSON.parse(await readFile(path,'utf8'));if(launchers.includes(data.path)){await unlink(path);console.log('Registration removed: '+browser)}}catch(e){if(e.code!=='ENOENT')throw e}
}
await rm(destination,{recursive:true,force:true});
console.log('Companion removed. Your ChatGPT sign-in was preserved.');
