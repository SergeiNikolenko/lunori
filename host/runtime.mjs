import { readFileSync,existsSync } from 'node:fs';
import { homedir } from 'node:os';
export const binary=process.env.LUNA_CODEX_BIN || ['/Applications/ChatGPT.app/Contents/Resources/codex','/Applications/Codex.app/Contents/Resources/codex',...(process.env.PATH||'').split(':').filter(Boolean).map(p=>p+'/codex')].find(p=>existsSync(p)) || '/Applications/Codex.app/Contents/Resources/codex';
export const privateHome=homedir()+'/Library/Application Support/LunaTranslate/account';
export const accountChoice=homedir()+'/Library/Application Support/LunaTranslate/account-source.json';
export function linkedAccount(){try{return JSON.parse(readFileSync(accountChoice,'utf8')).linked===true}catch{return false}}
export function cleanEnvironment({linked=linkedAccount()}={}){
 const env={};
 for(const key of ['HOME','PATH','TMPDIR','LANG','LC_ALL','USER','LOGNAME','SHELL','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','SSL_CERT_FILE','CODEX_CA_CERTIFICATE'])if(process.env[key])env[key]=process.env[key];
 if(linked)env.CODEX_HOME=privateHome;
 env.RUST_LOG='error';return env;
}
