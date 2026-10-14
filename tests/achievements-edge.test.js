import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
import * as core from '../src/core.js';import * as access from '../src/access-policy.js';import * as patch from '../src/state-patch.js';import * as rules from '../src/notification-rules.js';
import * as media from '../src/card-media.js';
const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8');const code=stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,''));
const catalog=fs.readFileSync('supabase/functions/party-api/catalog.ts','utf8'),start=catalog.indexOf('async function catalogRoom('),end=catalog.indexOf('\n}',start)+2;
const roomCode=stripTypeScriptTypes(catalog.slice(start,end));
function fixture(role='player',options={}){
 let handler;const calls=[],actor={role,accountId:'11111111-1111-4111-8111-111111111111',spaceId:role==='super_admin'?null:'space-001',playerId:role==='player'?'P1':null,streamerId:role==='streamer_admin'?'papa':null};
 const tasks=[];const fetch=async(url,request)=>{const path=new URL(url).pathname,b=typeof request.body==='string'?JSON.parse(request.body):request.body||null;calls.push({path,b});
  if(path.endsWith('/papa_verified_session_actor'))return Response.json(options.expired?null:actor);
  if(path.endsWith('/papa_streamer_directory')||path.endsWith('/papa_streamer_directory_in_space'))return Response.json([{id:'papa',slug:'papa',active:true,spaceId:'space-001'},{id:'other',slug:'other',active:true,spaceId:'space-001'}]);
  if(path.endsWith('/papa_song_favorite_audience'))return Response.json({counts:{S1:0}});
  if(path.endsWith('/papa_achievement_collection'))return Response.json({version:1,rows:[],total:0,page:0});
  if(path.startsWith('/storage/v1/object/papa-card-media/'))return Response.json({ok:true});
  assert.equal(b.actor_context.role,role);assert.equal(b.actor_context.account_id,actor.accountId);
  if(path.endsWith('/papa_activity_record'))return Response.json({ok:true});
  if(path.endsWith('/papa_activity_page'))return Response.json({version:1,spaceId:b.requested_space,page:b.page_number,pageSize:50,total:1,rows:[{player_id:'P1',streamer_id:'papa',page:'book',last_seen:'2026-10-14T10:00:00Z',online:true,secret:'private'}]});
  if(path.endsWith('/papa_achievement_page'))return Response.json({version:1,scope:{spaceId:'space-001',streamerId:'papa',playerId:b.requested_player},rows:[{code:'sung50',name:'50首兵郎',qualified:true,acquiredAt:null,secret:'private'}],...options.result});
  if(path.endsWith('/papa_achievement_public_state'))return Response.json({});
  if(path.endsWith('/papa_achievement_public_set'))return Response.json({ok:true,published:b.requested_enabled});
  if(path.endsWith('/papa_achievement_manual_grant'))return Response.json({ok:true,alreadyRecorded:false});
  if(path.endsWith('/papa_achievement_visibility_set'))return Response.json({ok:true});throw Error('Unexpected '+path);
 };
 const ctx=vm.createContext({...core,...access,...patch,...rules,...media,CATALOG_OPS:new Set(),Error,URL,Response,TextEncoder,Uint8Array,atob,crypto,structuredClone,fetch,EdgeRuntime:{waitUntil:p=>tasks.push(p)},Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.example':'fixture'},serve:fn=>handler=fn}});
 vm.runInContext(code,ctx);vm.runInContext(roomCode,ctx);
 const invoke=async(b={})=>{const r=await handler({method:'POST',json:async()=>({op:'achievements',token:(role==='player'?'player:':role==='streamer_admin'?'streamer:':'admin:')+'fixture',streamer:'papa',playerId:'P1',...b})});return{status:r.status,body:await r.json()};};
 return{calls,invoke,tasks};
}
test('player and managers use selected award RPC with verified actor; no full snapshots, secrets or target spoofing',async()=>{
 for(const role of ['player','streamer_admin','super_admin']){const f=fixture(role),r=await f.invoke({actor_context:{role:'super_admin'},recipient:'P2'});assert.equal(r.status,200);assert.equal(r.body.rows[0].name,'50首兵郎');assert.doesNotMatch(JSON.stringify(r.body),/secret|private/);assert.equal(f.calls.some(c=>/snapshot|entities/.test(c.path)),false);}
 const f=fixture();assert.equal((await f.invoke({playerId:'P2'})).status,400);assert.equal(f.calls.some(c=>c.path.endsWith('/papa_achievement_page')),false);
});
test('video upload is manager-only, checked before storage and uses a separate bounded video bucket',async()=>{
 const bytes=new Uint8Array([0,0,0,20,102,116,121,112,105,115,111,109]),video=Buffer.from(bytes).toString('base64');
 const f=fixture('streamer_admin'),r=await f.invoke({op:'uploadVideo',video,mime:'video/mp4'});assert.equal(r.status,200);assert.match(r.body.url,/papa-card-media\/.*\.mp4$/);
 for(const [role,b] of [['player',{video}],['streamer_admin',{video:'PGh0bWw+',mime:'video/mp4'}],['streamer_admin',{video,mime:'text/html'}],['streamer_admin',{video,streamer:'other'}]]){const g=fixture(role);assert.equal((await g.invoke({op:'uploadVideo',mime:'video/mp4',...b})).status,400);assert.equal(g.calls.some(c=>c.path.startsWith('/storage/')),false);}
});
test('activity is piggybacked on successful reads, throttled and cannot broaden monitor permissions',async()=>{
 const f=fixture();const body={activityPage:'book',activityVisible:true};await f.invoke(body);await Promise.all(f.tasks);await f.invoke(body);await Promise.all(f.tasks);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/papa_activity_record')).length,1);
 for(const role of ['player','streamer_admin']){const g=fixture(role);assert.equal((await g.invoke({op:'activityPage',page:0})).status,400);assert.equal(g.calls.some(c=>c.path.endsWith('/papa_activity_page')),false);}
 const g=fixture('super_admin'),r=await g.invoke({op:'activityPage',page:0});assert.equal(r.status,200);assert.doesNotMatch(JSON.stringify(r.body),/secret|private/);
});
test('cross-room/Space, expired session and player visibility writes reject before award access',async()=>{
 for(const [role,b,o] of [['player',{spaceId:'space-002'},{}],['streamer_admin',{streamer:'other'},{}],['player',{}, {expired:true}],['player',{op:'achievementVisibility',code:'sung50',visibility:'hidden'},{}]]){const f=fixture(role,o);assert.equal((await f.invoke(b)).status,400);assert.equal(f.calls.some(c=>c.path.includes('/papa_achievement_')),false);}
 const f=fixture('streamer_admin');assert.equal((await f.invoke({op:'achievementVisibility',code:'sung50',visibility:'after_award'})).status,200);
 const m=fixture('super_admin',{result:{scope:{spaceId:'foreign',streamerId:'papa',playerId:'P1'}}});assert.equal((await m.invoke()).status,400);
});

test('favorite audience is manager-only and cross-room actors cannot request names; collection rejects malformed inputs',async()=>{
 for(const [role,b] of [['player',{op:'favoriteAudience',songIds:['S1']}],['streamer_admin',{op:'favoriteAudience',songIds:['S1'],streamer:'other'}],['streamer_admin',{op:'favoriteAudience',songIds:Array(51).fill('S1')}],['player',{op:'achievementCollection',view:'gallery',playerKey:'account-uuid'}],['player',{op:'achievementCollection',view:'global',page:-1}]]){const f=fixture(role);assert.equal((await f.invoke(b)).status,400);assert.equal(f.calls.some(c=>/papa_song_favorite_audience|papa_achievement_collection/.test(c.path)),false);}
 const f=fixture('streamer_admin');assert.equal((await f.invoke({op:'favoriteAudience',songIds:['S1']})).status,200);const request=f.calls.find(c=>c.path.endsWith('/papa_song_favorite_audience'));assert.equal(request.b.requested_room,'papa');assert.equal(request.b.actor_context.actor_streamer_id,'papa');
 const p=fixture();assert.equal((await p.invoke({op:'achievementCollection',view:'global'})).status,200);
});
test('players alone set their public medals; managers alone certify historical awards',async()=>{
 const p=fixture(),published=await p.invoke({op:'achievementPublicSet',code:'sung50',published:true});
 assert.equal(published.status,200);assert.equal(published.body.published,true);
 assert.equal(p.calls.find(c=>c.path.endsWith('/papa_achievement_public_set')).b.actor_context.player_id,'P1');
 assert.equal((await fixture('streamer_admin').invoke({op:'achievementPublicSet',code:'sung50',published:true})).status,400);
 assert.equal((await fixture().invoke({op:'achievementManualGrant',playerId:'P1',code:'sung50',reason:'舊紀錄核對'})).status,400);
 const manager=fixture('streamer_admin'),grant=await manager.invoke({op:'achievementManualGrant',playerId:'P1',code:'sung50',reason:'舊紀錄核對'});
 assert.equal(grant.status,200);assert.equal(manager.calls.find(c=>c.path.endsWith('/papa_achievement_manual_grant')).b.requested_player,'P1');
});
