import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicShare} from '../src/share-dialog.js';

function fixture({navigator={},renderQr,execCopy=true,FileImpl=File}={}){
 const nodes=new Map(),listeners=new Map(),made=[],revoked=[],modals=[],downloads=[],copied=[],toasts=[],timers=[];
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{disabled:['[data-share-png]','[data-share-svg]','[data-share-native]'].includes(selector),hidden:false,textContent:'',focus(){this.focused=true;},select(){this.selected=true;},replaceChildren(child){this.child=child;},isConnected:true});return nodes.get(selector);};
 const panel={isConnected:true,querySelector:node};
 const dialog={open:true,querySelector:s=>s==='.public-share'?panel:null,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}};
 const document={querySelector:s=>s==='#dialog'?dialog:null,execCommand:command=>{copied.push(command);return execCopy;},body:{append(){}},createElement:tag=>tag==='a'?{click(){downloads.push({href:this.href,name:this.download});},remove(){}}:{}};
 const share=createPublicShare({modal:(title,body)=>modals.push({title,body}),toast:x=>toasts.push(x),document,navigator,
  URLImpl:{createObjectURL:blob=>{const url='blob:'+made.length;made.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)},FileImpl,
  renderQr:renderQr||(async()=>({pngBlob:new Blob(['png'],{type:'image/png'}),svgBlob:new Blob(['svg'],{type:'image/svg+xml'})})),setTimer:fn=>timers.push(fn)});
 return {share,nodes,node,dialog,modals,downloads,made,revoked,copied,toasts,timers,close(){dialog.open=false;listeners.get('close')?.();}};
}
const homepage={name:'怕怕',url:'https://paparty.app/pa'};
test('open prepares viewed public homepage without copying or sharing; title safe and hall supported',async()=>{
 let calls=0;const f=fixture({navigator:{share:async()=>calls++,clipboard:{writeText:async()=>calls++}}});
 await f.share.open(homepage);assert.equal(calls,0);assert.equal(f.modals[0].title,'分享【怕怕】的首頁');
 assert.match(f.modals[0].body,/https:\/\/paparty.app\/pa/);assert.ok(f.node('[data-share-preview]').child);assert.equal(f.node('[data-share-png]').disabled,false);
 await f.share.open({name:'聲瑪',url:'https://paparty.app/sm',kind:'hall'});assert.equal(f.modals[1].title,'分享聲瑪大廳');
 assert.equal(f.revoked.length,1,'reopening discards the old QR object URL');
});
test('copy reports success only after actual copy; permission denied selects fallback',async()=>{
 const texts=[];const f=fixture({navigator:{clipboard:{writeText:async text=>texts.push(text)}}});const c=await f.share.open(homepage);assert.equal(await c.copy(),true);assert.deepEqual(texts,[homepage.url]);assert.equal(f.node('[data-share-status]').textContent,'已複製');
 const denied=fixture({navigator:{clipboard:{writeText:async()=>{throw new DOMException('denied','NotAllowedError');}}},execCopy:false});
 const d=await denied.share.open(homepage);assert.equal(await d.copy(),false);assert.equal(denied.node('[data-share-url]').selected,true);assert.equal(denied.toasts.length,0);assert.match(denied.node('[data-share-status]').textContent,/長按/);
});
test('native share uses QR image only when supported, otherwise exact homepage text',async()=>{
 const payloads=[];const f=fixture({navigator:{canShare:payload=>payload.files[0].type==='image/png',share:async payload=>payloads.push(payload)}});
 const c=await f.share.open(homepage);assert.equal(await c.share(),'shared-image');assert.equal(payloads.length,1);assert.equal(payloads[0].url,homepage.url);assert.equal(payloads[0].files[0].name,'PA-Party-怕怕-QR.png');
 const text=[];const t=fixture({navigator:{canShare:()=>false,share:async p=>text.push(p)}});const tc=await t.share.open(homepage);assert.equal(await tc.share(),'shared-link');assert.equal('files' in text[0],false);
});
test('user cancel never copies or retries and concurrent taps share once',async()=>{
 let calls=0,release;const f=fixture({navigator:{canShare:()=>true,share:()=>{calls++;return new Promise((resolve,reject)=>release=()=>reject(new DOMException('cancel','AbortError')));},clipboard:{writeText:async()=>assert.fail('cancel must not copy')}}});
 const c=await f.share.open(homepage),pending=c.share();await c.share();assert.equal(calls,1);release();assert.equal(await pending,'cancelled');assert.equal(f.copied.length,0);assert.equal(f.node('[data-share-status]').textContent,'');
});
test('unsupported image retries text once; absent share API copies without transmitting',async()=>{
 const calls=[];const f=fixture({navigator:{canShare:()=>true,share:async payload=>{calls.push(payload);if(payload.files)throw new TypeError('file unsupported');}}});
 const c=await f.share.open(homepage);assert.equal(await c.share(),'shared-link');assert.equal(calls.length,2);assert.equal('files' in calls[1],false);
 const g=fixture();const gc=await g.share.open(homepage);assert.equal(await gc.share(),'copied');assert.deepEqual(g.copied,['copy']);
});
test('downloads use PNG and self-contained SVG, have image-open fallback and release blob URLs',async()=>{
 const f=fixture(),c=await f.share.open(homepage);c.downloadPng();c.downloadSvg();assert.deepEqual(f.downloads.map(x=>x.name),['PA-Party-怕怕-QR.png','PA-Party-怕怕-QR.svg']);
 assert.equal(f.node('[data-share-image]').hidden,false);assert.match(f.node('[data-share-image]').href,/^blob:/);
 f.close();assert.equal(f.revoked.length,3);f.timers.forEach(fn=>fn());assert.equal(f.revoked.length,3);assert.equal(c.downloadPng(),false);
});
test('late QR completion after close cannot mutate or leak object URL; QR failure still permits text sharing',async()=>{
 let resolve;const f=fixture({renderQr:()=>new Promise(r=>resolve=r)}),pending=f.share.open(homepage);f.close();resolve({pngBlob:new Blob(['x']),svgBlob:new Blob(['x'])});await pending;assert.equal(f.made.length,0);
 const g=fixture({renderQr:async()=>{throw Error('local render failed');}});const gc=await g.share.open(homepage);assert.equal(g.node('[data-share-native]').disabled,false);assert.equal(g.node('[data-share-png]').disabled,true);assert.equal(await gc.copy(),true);
});
test('private URLs rejected before opening a dialog and malicious display names are escaped',async()=>{
 const f=fixture();await assert.rejects(f.share.open({...homepage,url:'https://paparty.app/pa?token=secret'}));assert.equal(f.modals.length,0);
 await f.share.open({...homepage,name:'<img onerror="bad">'});assert.doesNotMatch(f.modals[0].body,/<img onerror/);assert.match(f.modals[0].body,/&lt;img/);
});
test('canvas unavailable preserves SVG preview and download without a broken PNG button',async()=>{
 const f=fixture({renderQr:async()=>({pngBlob:null,svgBlob:new Blob(['self-contained svg'],{type:'image/svg+xml'}),warning:'canvas unavailable'})}),c=await f.share.open(homepage);
 assert.equal(f.node('[data-share-png]').disabled,true);assert.equal(f.node('[data-share-svg]').disabled,false);assert.ok(f.node('[data-share-preview]').child);assert.equal(c.downloadPng(),false);assert.equal(c.downloadSvg(),true);
});
