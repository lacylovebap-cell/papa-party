import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import {DEFAULTS,TABLES} from '../src/core.js';

// Load the actual Edge handler without writing or building a deploy bundle.
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const code=['src/native-player-bindings.js','src/board-policy.js','supabase/functions/party-api/board.ts',
 'src/chat-policy.js','supabase/functions/party-api/chat.ts','src/home-settings.js','src/venue-policy.js','src/new-practice.js',
 'src/core.js','src/state-patch.js','src/room-import.js','src/room-draft.js','src/notification-rules.js','src/access-policy.js',
 'supabase/functions/party-api/catalog.ts','supabase/functions/party-api/index.ts']
 .map(path=>read(path).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const hash=token=>createHash('sha256').update(token).digest('hex');
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const tokens={president:'admin:old-president',streamer:'streamer:old-papa',player:'player:old-one',device:'device:current-player'};
const originalActors={
 president:{role:'super_admin',accountId:null,spaceId:null,playerId:null,streamerId:null},
 streamer:{role:'streamer_admin',accountId:null,spaceId:'space-001',playerId:null,streamerId:'papa'},
 player:{role:'player',accountId:null,spaceId:'space-001',playerId:'P1',streamerId:null,loginId:'old-platform-id'},
 device:{role:'player',accountId:uuid(4),spaceId:'space-001',playerId:'P1',streamerId:null,deviceSessionId:uuid(40)}
};
const identity=(role,accountId,spaceId=null,playerId=null,streamerId=null)=>({role,accountId,spaceId,playerId,streamerId});
function fixture(){
 const settings=structuredClone(DEFAULTS);
 return {schemaVersion:3,revision:7,settings,streamerSettings:{papa:structuredClone(settings),michelle:structuredClone(settings)},
  streamers:[{id:'papa',slug:'papa',display_name:'怕怕',active:true,spaceId:'space-001'},
   {id:'michelle',slug:'michelle',display_name:'米雪',active:true,spaceId:'space-001'},
   {id:'native',slug:'native',display_name:'Native',active:true,spaceId:'space-002'}],
  players:[{playerId:'P1',name:'Old player',ids:['old-platform-id'],names:[],password:'PRIVATE_PASSWORD',note:'PRIVATE_NOTE',test:false}],
  songs:[{songId:'song',streamer_id:'papa',title:'Song',artist:'Artist',tags:[],lyrics:'PRIVATE_LYRICS'}],
  ledger:[],queue:[],crowns:[],cards:[],wishes:[],extraQuotas:[]};
}
function edge({actors={},bound,bindError,expired=[]}={}){
 const calls=[],server=fixture(),sessions=new Map(Object.entries(tokens).map(([key,token])=>[hash(token),{
  key,actor:structuredClone(Object.hasOwn(actors,key)?actors[key]:originalActors[key])
 }]));let handler;
 const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,webpush:{},
  Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://fixture.test':'fixture-only'},serve:value=>handler=value},
  EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('Unexpected network');}});
 vm.runInContext(stripTypeScriptTypes(code),context);
 function snapshot(lean=true){
  const rows=TABLES.flatMap(kind=>server[kind].map((source,index)=>{
   const data=structuredClone(source);if(lean&&kind==='songs')delete data.lyrics;
   return {kind,id:String(kind==='players'?data.playerId:kind==='songs'?data.songId:data.id),data:{...data,_order:index}};
  }));
  rows.push({kind:'settings',id:'1',data:server.settings},{kind:'meta',id:'1',data:{schemaVersion:3,
   streamers:server.streamers.filter(room=>room.spaceId==='space-001'),streamerSettings:server.streamerSettings}});
  return {revision:server.revision,rows,extraQuotas:structuredClone(server.extraQuotas),extraQuotaRights:{}};
 }
 context.mockApi=async(path,body)=>{
  calls.push({path,body:plain(body)});
  if(path.endsWith('/papa_verified_session_actor')){
   const session=sessions.get(body.session_hash),actor=session?.actor;
   if(!actor||expired.includes(session.key))return null;
   const room=body.requested_room&&server.streamers.find(row=>row.id===body.requested_room||row.slug===body.requested_room);
   if(body.requested_room&&(!room||actor.role==='streamer_admin'&&actor.streamerId!==room.id||actor.role==='player'&&actor.spaceId!==room.spaceId))return null;
   return structuredClone(actor);
  }
  if(path.endsWith('/papa_bind_verified_legacy_session')){
   if(bindError)throw Error(bindError);
   const session=sessions.get(body.session_hash);assert.ok(session);assert.equal(session.actor.accountId==null,true,'bound accounts must never be rebound');
   if(bound!==undefined)return structuredClone(bound);
   const accountId=uuid({president:1,streamer:2,player:3}[session.key]);session.actor.accountId=accountId;
   return {accountId,role:session.actor.role==='super_admin'?'president':session.actor.role,spaceId:session.actor.spaceId,
    ...(session.actor.streamerId?{streamerId:session.actor.streamerId}:{})};
  }
  if(path.endsWith('/papa_account_space_entry'))return {kind:'choice',total:2,membershipCount:2,hasMore:false,spaces:[
   {id:'space-001',slug:'original',name:'Original',streamerCount:2,streamerId:'papa',streamerSlug:'papa',streamerName:'怕怕'},
   {id:'space-002',slug:'native',name:'Native',streamerCount:1,streamerId:'native',streamerSlug:'native',streamerName:'Native'}]};
  if(path.endsWith('/papa_v2_scoped_read_snapshot_with_quota')||path.endsWith('/papa_v2_scoped_read_snapshot_in_space')||path.endsWith('/papa_v2_room_write_snapshot_with_quota'))return snapshot();
  if(path.endsWith('/papa_catalog_song_metadata_in_space'))return [];
  if(path.endsWith('/papa_president_full_backup'))return {...snapshot(false),architecture:{formatVersion:1}};
  if(path.endsWith('/papa_manage_player_extra_quota')){
   assert.equal(body.actor_context.account_id,uuid(2));assert.equal(body.actor_context.role,'streamer_admin');
   assert.equal(body.actor_context.space_id,'space-001');assert.equal(body.actor_context.actor_streamer_id,'papa');
   assert.equal('session_hash' in body,false);assert.equal(body.expected,server.revision);
   server.extraQuotas.push({streamer_id:body.requested_room,player_id:body.target_player,extra_quota:body.requested_extra,enabled:body.requested_enabled});
   return ++server.revision;
  }
  throw Error('Unexpected database RPC: '+path);
 };
 vm.runInContext('api=async(path,body)=>mockApi(path,body);schedulePush=()=>{};',context);
 const request=async(body,token=tokens.player)=>{const response=await handler({method:'POST',json:async()=>({token,...body})});return {status:response.status,data:await response.json()};};
 return {context,calls,request,sessions};
}
const rpc=(h,name)=>h.calls.filter(call=>call.path.endsWith('/'+name));

test('each valid legacy role upgrades once with two authentication RPCs, then uses one verified lookup',async()=>{
 for(const key of ['president','streamer','player']){
  const h=edge(),first=plain(await h.context.actor(tokens[key],'papa')),accountId=uuid({president:1,streamer:2,player:3}[key]);
  assert.equal(first.accountId,accountId);assert.equal(first.role,originalActors[key].role);assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls.map(call=>call.body),[{session_hash:hash(tokens[key]),requested_room:'papa'},{session_hash:hash(tokens[key])}]);
  const second=plain(await h.context.actor(tokens[key],'papa'));assert.deepEqual(second,first);assert.equal(h.calls.length,3);assert.equal(rpc(h,'papa_bind_verified_legacy_session').length,1);
  if(key==='player'){assert.equal(first.playerId,'P1');assert.equal(first.loginId,'old-platform-id');assert.equal(first.spaceId,'space-001');}
  if(key==='streamer'){assert.equal(first.streamer_id,'papa');assert.equal(first.spaceId,'space-001');}
 }
});

test('existing Accounts and device sessions are never rebound or replaced by another Account',async()=>{
 const h=edge({actors:{player:{...originalActors.player,accountId:uuid(90)}}});
 assert.equal((await h.context.actor(tokens.player,'papa')).accountId,uuid(90));assert.equal(h.calls.length,1);assert.equal(rpc(h,'papa_bind_verified_legacy_session').length,0);
 const device=edge();assert.equal((await device.context.actor(tokens.device,'papa')).accountId,uuid(4));assert.equal(device.calls.length,1);
 const unbound=edge({actors:{device:{...originalActors.device,accountId:null}}});assert.equal(await unbound.context.actor(tokens.device,'papa'),null);assert.equal(unbound.calls.length,1);
 const mislabeled=edge({actors:{player:{...originalActors.player,deviceSessionId:uuid(40)}}});assert.equal(await mislabeled.context.actor(tokens.player,'papa'),null);assert.equal(mislabeled.calls.length,1);
});

test('anonymous, expired, prefix-spoofed or malformed sessions cannot invoke the binder',async()=>{
 for(const token of ['',null,42,'unknown:token']){const h=edge();assert.equal(await h.context.actor(token,'papa'),null);assert.equal(h.calls.length,0);}
 for(const config of [{expired:['player']},{actors:{player:null}},{actors:{player:[]}},{actors:{player:{...originalActors.president}}},
  {actors:{player:{...originalActors.player,spaceId:'space-002'}}},{actors:{player:{...originalActors.player,playerId:''}}},
  {actors:{player:{...originalActors.player,accountId:''}}},{actors:{player:{...originalActors.player,accountId:'forged'}}}]){
  const h=edge(config);assert.equal(await h.context.actor(tokens.player,'papa'),null);assert.equal(h.calls.length,1);assert.equal(rpc(h,'papa_bind_verified_legacy_session').length,0);
 }
 const h=edge({expired:['president']});const response=await h.request({op:'backup',accountId:uuid(99),role:'super_admin'},tokens.president);
 assert.equal(response.status,400);assert.equal(h.calls.length,1);assert.equal(rpc(h,'papa_president_full_backup').length,0);
});

test('the original requested-room gate runs before binding and player upgrades remain exactly in Space001',async()=>{
 for(const [key,room] of [['streamer','michelle'],['player','native'],['player','unknown']]){
  const h=edge();assert.equal(await h.context.actor(tokens[key],room),null);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].body.requested_room,room);assert.equal(rpc(h,'papa_bind_verified_legacy_session').length,0);
 }
 const h=edge({actors:{streamer:{...originalActors.streamer,streamerId:'native',spaceId:'space-002'}}});
 const who=await h.context.actor(tokens.streamer,'native');assert.equal(who.streamer_id,'native');assert.equal(who.spaceId,'space-002');assert.equal(h.calls.length,2);
});

test('null, malformed, disabled, role/Space/room/player-mismatched binder results never authorize a request',async()=>{
 const valid={accountId:uuid(3),role:'player',spaceId:'space-001'};
 for(const bound of [null,[],{},'forged',{...valid,accountId:'bad'},{...valid,role:'president'},{...valid,spaceId:null},
  {...valid,spaceId:'space-002'},{...valid,streamerId:'papa'},{...valid,playerId:'P2'}]){
  const h=edge({bound}),response=await h.request({op:'spaceEntry',role:'super_admin',accountId:uuid(99),spaceId:'space-002',playerId:'P2'});
  assert.equal(response.status,400);assert.equal(h.calls.length,2);assert.equal(rpc(h,'papa_account_space_entry').length,0);
 }
 for(const [key,bound] of [['president',{accountId:uuid(1),role:'super_admin',spaceId:null}],
  ['president',{accountId:uuid(1),role:'president',spaceId:'space-001'}],
  ['streamer',{accountId:uuid(2),role:'streamer_admin',spaceId:'space-001',streamerId:'michelle'}],
  ['streamer',{accountId:uuid(2),role:'streamer_admin',spaceId:'space-002',streamerId:'papa'}]]){
  const h=edge({bound});assert.equal(await h.context.actor(tokens[key],'papa'),null);assert.equal(h.calls.length,2);
 }
 const disabled=edge({bindError:'ACCOUNT_DISABLED'}),response=await disabled.request({op:'spaceEntry'});
 assert.equal(response.status,400);assert.match(response.data.error,/ACCOUNT_DISABLED/);assert.equal(disabled.calls.length,2);
});

test('project and spaceEntry expose only their own lightweight identity without accepting body identity or binder secrets',async()=>{
 const h=edge(),response=await h.request({op:'read',streamer:'papa',revision:-1,role:'super_admin',accountId:uuid(99),playerId:'P2',profilePlayerId:'P2'});
 assert.equal(response.status,200);assert.deepEqual(response.data.sessionIdentity,identity('player',uuid(3),'space-001','P1'));
 assert.deepEqual(response.data.state.players.map(row=>row.playerId),['P1']);assert.equal(JSON.stringify(response.data).includes('PRIVATE_PASSWORD'),false);
 const start=h.calls.length,entry=await h.request({op:'spaceEntry',streamer:'michelle',accountId:uuid(99),role:'super_admin'});
 assert.equal(entry.status,200);assert.deepEqual(entry.data.sessionIdentity,response.data.sessionIdentity);assert.equal(entry.data.membershipCount,2);
 assert.equal(h.calls.length-start,2,'a bound session has one auth lookup and one entry RPC');
 assert.equal(rpc(h,'papa_account_space_entry')[0].body.subject,uuid(3));assert.equal(rpc(h,'papa_account_space_entry')[0].body.actor_role,'player');
 const manager=edge(),own=await manager.request({op:'spaceEntry',streamer:'michelle',accountId:uuid(99)},tokens.streamer);
 assert.deepEqual(own.data.sessionIdentity,identity('streamer_admin',uuid(2),'space-001',null,'papa'));
 assert.equal(rpc(manager,'papa_account_space_entry')[0].body.chosen_streamer,'papa');
 const extras=edge({bound:{accountId:uuid(3),role:'player',spaceId:'space-001',password:'BINDER_SECRET',token:'BINDER_SECRET',deviceSessionId:'BINDER_SECRET'}});
 const clean=await extras.request({op:'spaceEntry'});assert.equal(clean.status,200);assert.equal(JSON.stringify(clean.data).includes('BINDER_SECRET'),false);
 assert.deepEqual(Object.keys(clean.data.sessionIdentity).sort(),['accountId','playerId','role','spaceId','streamerId']);
 const device=edge(),current=await device.request({op:'spaceEntry'},tokens.device);assert.deepEqual(current.data.sessionIdentity,identity('player',uuid(4),'space-001','P1'));
 assert.equal(JSON.stringify(current.data.sessionIdentity).includes('device'),false);assert.equal(rpc(device,'papa_bind_verified_legacy_session').length,0);
 const guest=edge(),publicRead=await guest.request({op:'read',streamer:'papa',revision:-1},'');assert.equal(publicRead.status,200);assert.equal('sessionIdentity' in publicRead.data,false);
});

test('upgraded president backup and streamer extra-quota use canonical Accounts while preserving their original contracts',async()=>{
 const president=edge(),backup=await president.request({op:'backup',accountId:uuid(99)},tokens.president);
 assert.equal(backup.status,200);assert.deepEqual(rpc(president,'papa_president_full_backup').map(call=>call.body),[{subject:uuid(1)}]);
 assert.equal(backup.data.backup.players[0].password,'PRIVATE_PASSWORD');assert.equal(backup.data.backup.songs[0].lyrics,'PRIVATE_LYRICS');
 assert.equal(backup.data.backup.architecture.formatVersion,1);assert.equal('sessionIdentity' in backup.data,false);assert.equal(president.calls.length,3);
 const entry=await president.request({op:'spaceEntry'},tokens.president);assert.deepEqual(entry.data.sessionIdentity,identity('super_admin',uuid(1)));
 const manager=edge(),grant=await manager.request({op:'mutate',streamer:'papa',revision:7,accountId:uuid(99),actor_context:{role:'super_admin'},
  action:{type:'extraQuota',data:{player_id:'P1',extra_quota:2,enabled:true}}},tokens.streamer);
 assert.equal(grant.status,200);assert.equal(grant.data.state.revision,8);assert.deepEqual(grant.data.sessionIdentity,identity('streamer_admin',uuid(2),'space-001',null,'papa'));
 assert.equal(rpc(manager,'papa_manage_player_extra_quota').length,1);assert.equal(rpc(manager,'papa_bind_verified_legacy_session').length,1);
 assert.equal(manager.calls.length,5,'two first-use auth RPCs, one scoped source, one atomic grant, one metadata projection');
});
