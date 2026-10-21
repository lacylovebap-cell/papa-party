import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicAppHomes} from '../supabase/functions/party-api/pwa-homes.js';
import {canonicalPublicHome,parsePublicRoutePath} from '../src/public-route-location.js';
for(const path of ['/pa','/qq/Artist','/pa.Independent','/qq.Artist'])test('APP source preserves valid public path '+path,async()=>{
 const row={kind:'streamer',spaceId:'h',streamerId:'s',streamerSlug:'artist',name:'Artist',spaceName:'Hall',active:true,canonicalPath:path,homePath:path};
 const homes=createPublicAppHomes({api:async()=>({items:[row],page:1,pageSize:1,total:1,totalPages:1})});
 const result=await homes.one({v:1,kind:'streamer',spaceId:'h',streamerId:'s'});assert.equal(result.canonicalPath,path);assert.equal(canonicalPublicHome('https://paparty.app',path),'https://paparty.app'+path);
 assert.ok(parsePublicRoutePath('https://paparty.app'+path+'/book',{mountUrl:'https://paparty.app/'}).candidates.some(x=>x.homepagePath===path&&x.section==='book'));
});
test('APP home adapter rejects traversal, third home segment and secret-bearing URL',async()=>{
 for(const path of ['/qq/../x','/qq/Artist/third','/pa?token=secret','//evil.example/x']){
 const row={kind:'streamer',spaceId:'h',streamerId:'s',streamerSlug:'artist',name:'Artist',spaceName:'Hall',active:true,canonicalPath:path,homePath:path};
 const homes=createPublicAppHomes({api:async()=>({items:[row],page:1,pageSize:1,total:1,totalPages:1})});await assert.rejects(homes.one({v:1,kind:'streamer',spaceId:'h',streamerId:'s'}),/尚未確認/);
 }
});
