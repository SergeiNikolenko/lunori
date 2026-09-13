"""Build explicit, credential-free distribution archives from reviewed release files."""
import argparse, hashlib, json, re, zipfile
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--plugin',type=Path,required=True)
parser.add_argument('--site',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
out=args.site.resolve()/'dist/downloads'
out.mkdir(parents=True,exist_ok=True)

def archive(name,files):
    path=out/name
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
        for source,target in sorted(files,key=lambda pair:pair[1]):
            if source.is_symlink():raise ValueError('Unexpected symlink: '+str(source))
            if source.suffix in ('.js','.mjs','.json','.txt','.md','.command'):
                text=source.read_text()
                if re.search(r'/Users/[^/\s]+|sk-proj-[A-Za-z0-9]|BEGIN PRIVATE KEY',text):raise ValueError('Private build data in '+str(source))
            z.write(source,target)
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        assert not any('/node_modules/' in p or 'auth.json' in p or '.env' in p for p in z.namelist())
    print(name,path.stat().st_size)
    return hashlib.sha256(path.read_bytes()).hexdigest()+'  '+name

extension=[(p,str(p.relative_to(root/'extension'))) for p in (root/'extension').rglob('*') if p.is_file()]
mac=[(p,'Lunori/extension/'+name) for p,name in extension]
mac += [(p,'Lunori/host/'+p.name) for p in (root/'host').iterdir() if p.suffix in ('.mjs','.json','.txt')]
mac += [(root/name,'Lunori/'+name) for name in ('Install.command','README.md','PRIVACY.md')]
plugin=[(p,'lunori/'+str(p.relative_to(args.plugin))) for p in args.plugin.rglob('*') if p.is_file()]
checks=[archive('lunori-chrome-web-store.zip',extension),archive('lunori-macos.zip',mac),archive('lunori-codex.zip',plugin)]
(out/'SHA256SUMS.txt').write_text('\n'.join(checks)+'\n')
