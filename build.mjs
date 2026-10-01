import {readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import{build}from'esbuild';import{execFileSync}from'node:child_process';
const uiBuild=await build({metafile:true,entryPoints:['src/App.tsx'],outfile:'extension/popup.js',bundle:true,minify:true,format:'iife',target:['chrome120'],define:{'process.env.NODE_ENV':'"production"'},legalComments:'none'});
execFileSync(process.execPath,['node_modules/@tailwindcss/cli/dist/index.mjs','-i','src/styles.css','-o','extension/popup.css','--minify'],{stdio:'inherit'});

const source=await readFile('extension/content.js','utf8');
const theme=await readFile('src/menu.css','utf8');
await writeFile('extension/content.js',source.replace(/\/\* MENU_THEME_START \*\/[\s\S]*?\/\* MENU_THEME_END \*\//,()=> '/* MENU_THEME_START */\n  launcherStyle.textContent += '+JSON.stringify(theme)+';\n  /* MENU_THEME_END */'));

const hostBuild=await build({entryPoints:['host/dependencies-entry.mjs'],outfile:'host/dependencies.mjs',bundle:true,platform:'node',format:'esm',target:'node22',metafile:true,banner:{js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'},legalComments:'inline'});
const packages=new Set();
for(const result of [uiBuild,hostBuild])for(const input of Object.keys(result.metafile.inputs)){const match=input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);if(match)packages.add(match[1]);}
let notices='# Third-party notices\n\nLunori original code is MIT licensed. Bundled dependencies retain the following licenses. OpenAI DevKit code is not bundled.\n';
for(const name of [...packages].sort()){
 const directory='node_modules/'+name;const meta=JSON.parse(await readFile(directory+'/package.json','utf8'));
 notices+='\n## '+name+' '+meta.version+' ('+(meta.license||'see upstream')+')\n\n';
 const files=(await readdir(directory)).filter(n=>/^(license|licence|copying)(\.|$)/i.test(n));
 if(!files.length)notices+=await readFile('licenses/'+name.replaceAll('/','_')+'.txt','utf8')+'\n';
 for(const file of files)notices+=await readFile(directory+'/'+file,'utf8')+'\n';
}
notices=notices.replace(/\r\n/g,'\n').split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n';
await writeFile('THIRD_PARTY_NOTICES.md',notices);
await writeFile('host/THIRD_PARTY_NOTICES.txt',notices);
await writeFile('extension/THIRD_PARTY_NOTICES.txt',notices);
for(const name of await readdir('host'))if(/\.(mjs|json|txt)$/.test(name)&&name!=='dependencies-entry.mjs'&&!['install.mjs','uninstall.mjs','native.mjs'].includes(name))await copyFile('host/'+name,'plugins/lunori/host/'+name);
for(const name of ['LICENSE','PRIVACY.md','THIRD_PARTY_NOTICES.md'])await copyFile(name,'plugins/lunori/'+name);

await copyFile('LICENSE','extension/LICENSE.txt');
await copyFile('LICENSE','host/LICENSE.txt');
await copyFile('LICENSE','plugins/lunori/host/LICENSE.txt');
