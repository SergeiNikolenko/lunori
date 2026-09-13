import {writeFileSync,readFileSync} from 'node:fs';import{deflateSync}from'node:zlib';
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(name,body){const type=Buffer.from(name),data=Buffer.concat([type,body]);let crc=0xffffffff;for(const v of data)crc=table[(crc^v)&255]^(crc>>>8);const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(body.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,data,tail]);}
for(const size of [16,32,48,128]){
 const rows=Buffer.alloc((size*4+1)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const acc=[0,0,0,0];
  for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){
   const px=(x+(sx+.5)/4)/size,py=(y+(sy+.5)/4)/size;
   const radius=.44,inside=Math.hypot(px-.5,py-.5)<radius;
   const crescent=inside&&py> .67-.55*px;
   const color=inside?(crescent?[23,23,23,255]:[245,245,245,255]):[0,0,0,0];
   for(let c=0;c<4;c++)acc[c]+=color[c]/16;
  }
  const offset=y*(size*4+1)+1+x*4;for(let c=0;c<4;c++)rows[offset+c]=Math.round(acc[c]);
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);writeFileSync(`extension/icon-${size}.png`,png);
}
const path='extension/manifest.json',manifest=JSON.parse(readFileSync(path));manifest.icons=Object.fromEntries([16,32,48,128].map(s=>[s,`icon-${s}.png`]));manifest.action.default_icon=manifest.icons;writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
