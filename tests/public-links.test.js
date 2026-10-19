import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicLinkClient,readPublicRouteContext,publicApplicationHref,publicApplicationPage} from '../src/public-links.js';
const mount='https://paparty.app/';
const metadata={version:1,kind:'streamer',spaceId:'space-001',streamerId:'papa',streamerSlug:'papa',canonicalPath:'/pa',configured:true,section:'book'};
const doc=value=>({querySelector:()=>({textContent:JSON.stringify(value)})});
test('pretty routing restores the existing room, subview and preference scope without creating identity',()=>{
 const href=mount+'pa/book?tab=ledger',context=readPublicRouteContext({document:doc(metadata),href,mountUrl:mount});
 assert.equal(context.streamerId,'papa');assert.equal(context.canonicalHome,mount+'pa');assert.equal(context.token,undefined);
 assert.equal(new URL(publicApplicationHref(href,context,mount)).searchParams.get('streamer'),'papa');
 assert.equal(publicApplicationPage(href,context,mount).route,'book');
 assert.equal(publicApplicationPage(mount+'pa/center?tab=achievements',context,mount).subtab,'achievements');
 assert.equal(publicApplicationPage(mount+'pa/admin?adminTab=players&player=P1&tab=ledger',context,mount).selectedPlayer,'P1');
 assert.equal(publicApplicationPage(mount+'pa',context,mount).route,'home');
 assert.equal(readPublicRouteContext({document:doc({...metadata,canonicalPath:'/other'}),href,mountUrl:mount}),null);
 assert.equal(readPublicRouteContext({document:doc({...metadata,streamerSlug:'../../admin'}),href,mountUrl:mount}),null);
});
test('a nonlegacy route retains explicit Space entry rather than reusing legacy business data',()=>{
 const context={...metadata,spaceId:'space-Q',canonicalPath:'/qq.ABC',canonicalHome:mount+'qq.ABC'};
 const url=new URL(publicApplicationHref(mount+'qq.ABC/book',context,mount));
 assert.equal(url.searchParams.get('spaceId'),'space-Q');assert.equal(url.hash,'#book');assert.equal(url.pathname,'/v2.html');
});
test('metadata lookup is scoped, coalesced and cached, never sends a login or downloads a directory',async()=>{
 const calls=[];let clock=0;
 const client=createPublicLinkClient({now:()=>clock,api:async body=>{calls.push(body);return metadata;}}),scope={spaceId:'space-001',streamerId:'papa'};
 const values=await Promise.all([client.info(scope),client.info(scope)]);assert.equal(calls.length,1);
 assert.deepEqual(calls[0],{op:'publicRouteInfo',kind:'streamer',spaceId:'space-001',streamerId:'papa'});
 assert.equal(client.shareUrl(values[0]),mount+'pa');await client.info(scope);assert.equal(calls.length,1);
 clock=60001;await client.info(scope);assert.equal(calls.length,2);client.invalidate();await client.info(scope);assert.equal(calls.length,3);
 await assert.rejects(client.info({...scope,streamerId:'other'}),/範圍/);
 await assert.rejects(client.info({...scope,spaceId:''}),/空間/);
});
test('unconfigured routes and poisoned public metadata cannot produce a fabricated share link',async()=>{
 const scope={kind:'streamer',spaceId:'space-001',streamerId:'papa'};
 const client=createPublicLinkClient({api:async()=>({...metadata,configured:false,canonicalPath:null})});
 const result=await client.info(scope);assert.throws(()=>client.shareUrl(result),/尚未啟用/);
 for(const canonicalPath of ['/admin','//evil.test','/pa?token=private','/pa#admin','/qq/../../admin']){
  const bad=createPublicLinkClient({api:async()=>({...metadata,canonicalPath})});await assert.rejects(bad.info(scope),/網址/);
 }
});
