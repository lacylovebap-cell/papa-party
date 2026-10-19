import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {publicShareUrl,publicQrSymbol,brandedQrSvg,renderBrandedQr} from '../src/branded-qr.js';

const official=fs.readFileSync(new URL('../assets/pa-party-approved.png',import.meta.url));
const logoDataUrl='data:image/png;base64,'+official.toString('base64');
test('share only accepts resolved public homepages and rejects private navigation',()=>{
 assert.equal(publicShareUrl('https://paparty.app/pa'),'https://paparty.app/pa');
 for(const url of ['https://paparty.app/','https://paparty.app/pa?token=private','https://paparty.app/pa#admin','https://paparty.app/admin','https://paparty.app/sm/admin','https://paparty.app/pa/songbook','https://paparty.app/pa/book','https://paparty.app/pa/center','https://evil.test/pa','https://user:pass@paparty.app/pa','javascript:alert(1)','http://paparty.app/pa']){
  assert.throws(()=>publicShareUrl(url),undefined,url);
 }
});
test('QR is H with four-module quiet zone and original embedded approved logo',()=>{
 const qr=publicQrSymbol('https://paparty.app/pa'),svg=brandedQrSvg(qr.url,{logoDataUrl});
 assert.equal(qr.errorCorrection,'H');assert.equal(qr.quietZone,4);assert.ok(qr.logoRatio<=.16);
 assert.equal(qr.modules.length,qr.size);assert.match(svg,/viewBox="0 0 37 37"/);
 assert.ok(svg.includes('href="'+logoDataUrl+'"'));assert.match(svg,/viewBox="818 270 568 472"/);
 assert.doesNotMatch(svg,/<script|https?:\/\/[^w]/); // xmlns is the sole URL, QR payload is encoded modules.
 assert.throws(()=>brandedQrSvg(qr.url,{logoDataUrl:'https://fake.test/logo.png'}));
 assert.throws(()=>brandedQrSvg(qr.url,{logoDataUrl,size:30}));
});
test('long public links leave centre alignment pattern clear',()=>{
 const qr=publicQrSymbol('https://paparty.app/'+'a'.repeat(180));
 assert.ok(qr.version>=14&&qr.version<=20);assert.equal(qr.errorCorrection,'H');
});
test('canvas renderer revokes temporary SVG URL on success and failure',async()=>{
 const made=[],revoked=[];let drawn=0;
 const URLImpl={createObjectURL:blob=>{made.push(blob);return 'blob:test-'+made.length;},revokeObjectURL:value=>revoked.push(value)};
 class ImageImpl{set src(v){queueMicrotask(()=>this.onload());}}
 const document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){drawn++;}}),toBlob:fn=>fn(new Blob(['PNG'],{type:'image/png'}))})};
 const value=await renderBrandedQr('https://paparty.app/pa',{document,ImageImpl,URLImpl,loadLogo:async()=>logoDataUrl});
 assert.equal(value.pngBlob.type,'image/png');assert.match(value.svgBlob.type,/image\/svg\+xml/);assert.equal(drawn,1);assert.deepEqual(revoked,['blob:test-1']);
 class BrokenImage{set src(v){queueMicrotask(()=>this.onerror());}}
 const fallback=await renderBrandedQr('https://paparty.app/pa',{document,ImageImpl:BrokenImage,URLImpl,loadLogo:async()=>logoDataUrl});
 assert.equal(fallback.pngBlob,null);assert.match(fallback.warning,/產生失敗/);assert.equal(fallback.svgBlob.size>0,true);
 assert.deepEqual(revoked,['blob:test-1','blob:test-2']);
});

let sharp;const require=createRequire(import.meta.url);
for(const candidate of ['sharp',path.resolve(path.dirname(process.execPath),'..','node_modules','sharp')]){
 try{sharp=require(candidate);break;}catch{}
}
const python=process.env.PA_QR_PYTHON||'python';
const cv=spawnSync(python,['-c','import cv2'],{encoding:'utf8'});
test('actual SVG and PNG decode to exact public URL at 256, 512, 1024px, with official logo',{
 skip:!sharp||cv.status!==0?'Offline scan requires local sharp and Python OpenCV (no production access).':false,
},async()=>{
 const cases=['https://paparty.app/pa','https://paparty.app/sm','https://paparty.app/other/PAPA520','https://paparty.app/'+'a'.repeat(180)];
 const decoder='import sys,cv2,numpy as np,json\na=np.frombuffer(sys.stdin.buffer.read(),dtype=np.uint8)\nim=cv2.imdecode(a,cv2.IMREAD_COLOR)\ntext,points,_=cv2.QRCodeDetector().detectAndDecode(im)\nprint(json.dumps(text))';
 for(const url of cases)for(const size of [256,512,1024])for(const branded of [false,true]){
  const svg=brandedQrSvg(url,{logoDataUrl,size,branded}),png=await sharp(Buffer.from(svg)).png().toBuffer();
  const scan=spawnSync(python,['-c',decoder],{input:png,encoding:'utf8',maxBuffer:1024*1024});
  assert.equal(scan.status,0,scan.stderr);assert.equal(JSON.parse(scan.stdout),url,`${url} / ${size}px / logo=${branded}`);
 }
});
