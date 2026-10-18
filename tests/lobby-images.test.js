import test from 'node:test';
import assert from 'node:assert/strict';
import {createLobbyImageReader,lobbyImageProjectionPath,lobbyHeroImage} from '../supabase/functions/party-api/lobby-images.js';

const room=(id='papa',extra={})=>({id,slug:id,display_name:id,banner_url:'https://images.example/banner.webp',...extra});
test('one bounded projection selects image scalars only, including canonical UUID room IDs',()=>{
 const path=lobbyImageProjectionPath(['papa','11111111-1111-4111-8111-111111111111']),url=new URL(path,'https://db.example');
 assert.equal(url.pathname,'/rest/v1/papa_v2_entities');assert.equal(url.searchParams.get('kind'),'in.(meta,settings)');assert.equal(url.searchParams.get('id'),'eq.1');assert.equal(url.searchParams.get('limit'),'2');
 const fields=url.searchParams.get('select').split(',');
 assert.equal(fields.length,7);assert.equal(fields[0],'kind');assert.equal(fields[1],'i0_mode:data->streamerSettings->"papa"->home->>imageMode');
 assert.match(fields[3],/^i1_mode:data->streamerSettings->"11111111-1111-4111-8111-111111111111"->home->>imageMode$/);
 assert.equal(fields[5],'legacy_mode:data->home->>imageMode');
 assert.equal(fields.some(field=>field==='data'||field.endsWith('->home')||field.includes('*')),false);
 assert.match(new URL(lobbyImageProjectionPath(['123']),'https://db.example').searchParams.get('select'),/->"123"->home/);
 for(const ids of [[],Array.from({length:21},(_,i)=>'r'+i),['same','same'],['papa,secret:data'],['a->password'],['x&select=data'],['x.y'],['x"']])assert.throws(()=>lobbyImageProjectionPath(ids));
});

test('home image mode respects current custom/default/none without exposing disabled stored URLs',()=>{
 const current=room();
 assert.equal(lobbyHeroImage(current,{mode:'custom',url:'https://images.example/upload.webp'}),'https://images.example/upload.webp');
 assert.equal(lobbyHeroImage(current,{mode:'none',url:'https://images.example/old-secret.webp'}),'');
 assert.equal(lobbyHeroImage(current,{mode:'default',url:'https://images.example/unused.webp'}),current.banner_url);
 assert.equal(lobbyHeroImage(room('papa',{banner_url:''})),'assets/papa-singer-hero.jpg');
 assert.equal(lobbyHeroImage(room('other',{banner_url:''})), '');
 for(const url of ['http://images.example/upload.webp','https://user:pass@images.example/a.webp','javascript:alert(1)','data:image/png;base64,AAAA','https://images.example/'+ 'a'.repeat(2048),'https://images.example/\nsecret']){
  assert.equal(lobbyHeroImage(current,{mode:'custom',url}),'');
 }
 assert.equal(lobbyHeroImage(room('other',{banner_url:'javascript:alert(1)'})), '');
});

test('parallel pages coalesce a single read and return only public image fields',async()=>{
 const calls=[];let release;
 const read=createLobbyImageReader({api:path=>{calls.push(path);return new Promise(resolve=>release=resolve);}});
 const rooms=[room('b',{password:'private'}),room('a',{settings:{private:'secret'}})];
 const first=read(rooms),second=read([...rooms].reverse());assert.equal(calls.length,1);
 release([{kind:'meta',i0_mode:'custom',i0_url:'https://images.example/a.webp',i1_mode:'none',i1_url:'https://images.example/hidden.webp',password:'private',data:{private:'never project'}}]);
 const [a,b]=await Promise.all([first,second]);assert.equal(a[0].heroImage,'');assert.equal(a[1].heroImage,'https://images.example/a.webp');assert.equal(b[0].heroImage,a[1].heroImage);
 assert.deepEqual(Object.keys(a[0]).sort(),['id','slug','display_name','heroImage'].sort());assert.doesNotMatch(JSON.stringify(a),/password|settings|private|secret|hidden/);
 assert.equal((await read(rooms))[1].heroImage,a[1].heroImage);assert.equal(calls.length,1);
});

test('schema-3 reset keeps default even if legacy row still contains a custom image',async()=>{
 const read=createLobbyImageReader({api:async()=>[{kind:'meta',i0_mode:null,i0_url:null},{kind:'settings',legacy_mode:'custom',legacy_url:'https://images.example/old.webp'}]});
 assert.equal((await read([room()]))[0].heroImage,'https://images.example/banner.webp');
 const legacy=createLobbyImageReader({api:async()=>[{kind:'settings',legacy_mode:'custom',legacy_url:'https://images.example/legacy.webp'}]});
 assert.equal((await legacy([room()]))[0].heroImage,'https://images.example/legacy.webp');
});

test('cache expiry is fixed, bounded and refreshed only when a page is requested',async()=>{
 let clock=0,count=0;const read=createLobbyImageReader({now:()=>clock,api:async()=>{count++;return [{kind:'meta',i0_mode:'none'}];}});
 await read([room()]);assert.equal(count,1);clock=59000;await read([room()]);assert.equal(count,1);
 clock=60000;await read([room()]);assert.equal(count,2);
 for(let n=0;n<13;n++)await read([room('r'+n)]);assert.equal(count,15);
 await read([room()]);assert.equal(count,16,'old page evicted after bounded twelve entries');
});

test('temporary projection failures preserve directory and are not retried on every render',async()=>{
 let clock=0,count=0;const read=createLobbyImageReader({now:()=>clock,api:async()=>{count++;throw Error('temporary read failure');}});
 assert.deepEqual(await read([room('other')]),[{id:'other',slug:'other',display_name:'other',heroImage:'https://images.example/banner.webp'}]);
 await read([room('other')]);assert.equal(count,1);clock=60000;await read([room('other')]);assert.equal(count,2);
 assert.deepEqual(await read([]),[]);assert.equal(count,2);
 const unsafe=await read([room('unsafe->id')]);assert.equal(count,2);assert.equal(unsafe[0].heroImage,'https://images.example/banner.webp');
 await assert.rejects(read(Array.from({length:21},(_,n)=>room('r'+n))));
});
