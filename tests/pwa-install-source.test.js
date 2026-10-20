import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInstallSource,encodeInstallSource,decodeInstallSource,installManifestUrl,prepareInstallManifest} from '../src/pwa-install-source.js';
import {createWebAppInstall} from '../src/web-app-install.js';

const streamer={v:1,kind:'streamer',spaceId:'space-001',streamerId:'stable-123'};
const hall={v:1,kind:'hall',spaceId:'future-hall',streamerId:null};
test('install payload round-trips public stable identities without names, mutable URLs or account fields',()=>{
 for(const source of [streamer,hall,{...streamer,spaceId:'空間-2',streamerId:'主播-ID'}]){
  const token=encodeInstallSource({...source,name:'must not leak',token:'private',url:'https://private.test'});
  assert.match(token,/^[A-Za-z0-9_-]+$/);assert.deepEqual(decodeInstallSource(token),source);
 }
 assert.deepEqual(normalizeInstallSource({...streamer,role:'super_admin'}),streamer);
});
test('malformed, secret-bearing, oversized and ambiguous install tokens fail closed',()=>{
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 for(const token of [null,'','abc=','a','!bad',encode({...streamer,token:'secret'}),encode({...streamer,v:2}),encode({...hall,streamerId:'wrong'}),encode({...streamer,spaceId:'bad space'}),encode({...streamer,streamerId:'\u202eprivate'}),'a'.repeat(1025),encode({...streamer,kind:'admin'}),encode({...streamer,streamerId:null})])assert.equal(decodeInstallSource(token),null,String(token));
 for(const value of [null,[],{}, {...streamer,v:2}, {...hall,streamerId:'not-null'}, {...streamer,streamerId:'x'.repeat(201)}])assert.equal(encodeInstallSource(value),null);
});
test('manifest source uses a genuine same-origin URL with stable app endpoint and no storage dependency',()=>{
 const first=new URL(installManifestUrl({source:streamer,mountUrl:'https://paparty.app/'}));
 assert.equal(first.pathname,'/manifest.webmanifest');assert.deepEqual(decodeInstallSource(first.searchParams.get('install')),streamer);
 assert.equal(installManifestUrl({source:null,mountUrl:'https://paparty.app/'}),'https://paparty.app/manifest.webmanifest');
 assert.equal(new URL(installManifestUrl({source:hall,mountUrl:'https://example.test/papa-party/'})).pathname,'/papa-party/manifest.webmanifest');
 assert.equal(installManifestUrl({source:streamer,mountUrl:'javascript:bad'}),null);
 assert.equal(installManifestUrl({source:streamer,mountUrl:'https://user:password@paparty.app/'}),null);
});
function documentFixture(){
 const values=new Map([['href','manifest.webmanifest']]);let writes=0;
 const link={getAttribute:key=>values.get(key),setAttribute:(key,value)=>{writes++;values.set(key,value);}};
 return {document:{baseURI:'https://paparty.app/pa',querySelector:selector=>{assert.equal(selector,'link[rel="manifest"]');return link;}},get href(){return values.get('href');},get writes(){return writes;}};
}
test('source manifest is prepared once before install events, with no fetch or localStorage',()=>{
 const f=documentFixture(),environment={document:f.document,location:{origin:'https://paparty.app'},navigator:{},get fetch(){assert.fail('no source fetch');},get localStorage(){assert.fail('no persistence');}};
 const controller=createWebAppInstall({environment,source:streamer,mountUrl:'https://paparty.app/'});
 assert.deepEqual(decodeInstallSource(new URL(f.href).searchParams.get('install')),streamer);
 controller.prepareSource(streamer);assert.equal(f.writes,1,'same source does not refetch manifest through href mutation');
 controller.prepareSource(hall);assert.deepEqual(decodeInstallSource(new URL(f.href).searchParams.get('install')),hall);
 controller.prepareSource(null);assert.equal(f.href,'https://paparty.app/manifest.webmanifest');controller.destroy();
});
test('preparing install refuses cross-origin manifests and creates only a missing manifest link',()=>{
 const f=documentFixture();assert.equal(prepareInstallManifest({document:f.document,source:streamer,mountUrl:'https://evil.test/'}),null);assert.equal(f.writes,0);
 let created,appended;const doc={baseURI:'https://paparty.app/pa',querySelector:()=>null,createElement:tag=>{assert.equal(tag,'link');return created={setAttribute(key,value){this[key]=value;}};},head:{appendChild:link=>{appended=link;}}};
 assert.ok(prepareInstallManifest({document:doc,source:streamer,mountUrl:'https://paparty.app/'}));assert.equal(created,appended);assert.equal(created.rel,'manifest');
});
test('changing the viewed install source cannot reuse the previous host install prompt',async()=>{
 const f=documentFixture(),listeners=new Map(),environment={document:f.document,location:{origin:'https://paparty.app'},navigator:{},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const controller=createWebAppInstall({environment,source:streamer});let prompted=0;
 const event=()=>({type:'beforeinstallprompt',isTrusted:true,preventDefault(){},prompt(){prompted++;},userChoice:Promise.resolve({outcome:'dismissed'})});
 listeners.get('beforeinstallprompt')(event());assert.equal(controller.snapshot().canPrompt,true);
 controller.prepareSource(streamer);assert.equal(controller.snapshot().canPrompt,true,'same scope retains gesture opportunity');
 controller.prepareSource(hall);assert.equal(controller.snapshot().canPrompt,false);assert.deepEqual(await controller.prompt(),{outcome:'unavailable'});assert.equal(prompted,0);
 listeners.get('beforeinstallprompt')(event());assert.equal((await controller.prompt()).outcome,'dismissed');assert.equal(prompted,1);
 controller.destroy();assert.equal(controller.prepareSource(streamer),null);
});
