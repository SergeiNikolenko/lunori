import {readFile,writeFile} from 'node:fs/promises';
import{build}from'esbuild';import{execFileSync}from'node:child_process';
await build({entryPoints:['src/App.tsx'],outfile:'extension/popup.js',bundle:true,minify:true,format:'iife',target:['chrome120'],define:{'process.env.NODE_ENV':'"production"'},legalComments:'none'});
execFileSync(process.execPath,['node_modules/@tailwindcss/cli/dist/index.mjs','-i','src/styles.css','-o','extension/popup.css','--minify'],{stdio:'inherit'});

const source=await readFile('extension/content.js','utf8');
const theme=await readFile('src/menu.css','utf8');
await writeFile('extension/content.js',source.replace(/\/\* MENU_THEME_START \*\/[\s\S]*?\/\* MENU_THEME_END \*\//,()=> '/* MENU_THEME_START */\n  launcherStyle.textContent += '+JSON.stringify(theme)+';\n  /* MENU_THEME_END */'));
