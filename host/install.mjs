import {readFile,writeFile,mkdir,chmod,access,readdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {binary} from './runtime.mjs';
if(process.platform!=='darwin')throw new Error('This companion requires macOS.');
if(Number(process.versions.node.split('.')[0])<22)throw new Error('Install Node.js 22 or newer.');
try{await access(binary)}catch{throw new Error('Install ChatGPT or Codex desktop, or put the Codex CLI on PATH. Sign in with ChatGPT before continuing.')}
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(root+'extension/manifest.json','utf8'));
const developmentId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
const id=process.argv[2]||developmentId;
if(!/^[a-p]{32}$/.test(id))throw new Error('Expected a 32-character Chrome extension ID.');
const destination=homedir()+'/Library/Application Support/Lunori/Companion';
await mkdir(destination+'/host',{recursive:true,mode:0o700});
for(const file of await readdir(root+'host'))if(/\.(mjs|json|txt)$/.test(file))await copyFile(root+'host/'+file,destination+'/host/'+file);
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const launcher=destination+'/launch';
await writeFile(launcher,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(destination+'/host/native.mjs')+'\n',{mode:0o755});await chmod(launcher,0o755);
const host={name:'com.lunatranslate.bridge',description:'Lunori · ChatGPT subscription',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]};
let installed=0;
for(const browser of ['Google/Chrome','Arc/User Data','Microsoft Edge','BraveSoftware/Brave-Browser']){
 const base=homedir()+'/Library/Application Support/'+browser;
 try{await access(base)}catch{continue}
 const directory=base+'/NativeMessagingHosts';await mkdir(directory,{recursive:true});
 await writeFile(directory+'/'+host.name+'.json',JSON.stringify(host,null,2)+'\n');
 installed++;console.log('Companion installed: '+browser);
}
if(!installed)throw new Error('Open Chrome or Arc once, then run this installer again.');
console.log('Lunori ID: '+id+'\nExtension folder: '+root+'extension\nCompanion files: '+destination);
