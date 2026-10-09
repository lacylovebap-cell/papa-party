import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import {TABLES,DEFAULTS,savedQuota} from '../src/core.js';

// Evaluate the actual handler and dependencies in memory. Tests do not write
// deployment bundles or replace the canonical actor resolver.
const root=new URL('../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root),'utf8');
const bundle=['src/native-player-bindings.js','src/board-policy.js','supabase/functions/party-api/board.ts',
 'src/chat-policy.js','supabase/functions/party-api/chat.ts','src/home-settings.js','src/venue-policy.js','src/new-practice.js',
 'src/core.js','src/state-patch.js','src/room-import.js','src/room-draft.js','src/notification-rules.js','src/access-policy.js',
 'supabase/functions/party-api/catalog.ts','supabase/functions/party-api/index.ts']
 .map(path=>read(path).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n');
const now='2026-10-09T12:30:00Z',hash=token=>createHash('sha256').update(token).digest('hex');
const account=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const tokens={player:'player:verified-one',other:'player:verified-two',manager:'streamer:verified-papa',foreign:'streamer:verified-michelle',president:'admin:verified-president'};
const sessions=new Map([
 [hash(tokens.player),{playerId:'P1',loginId:'one-alias',role:'player',accountId:account(1),spaceId:'space-001'}],
 [hash(tokens.other),{playerId:'P2',loginId:'two-alias',role:'player',accountId:account(2),spaceId:'space-001'}],
 [hash(tokens.manager),{role:'streamer_admin',streamerId:'papa',accountId:account(3),spaceId:'space-001'}],
 [hash(tokens.foreign),{role:'streamer_admin',streamerId:'michelle',accountId:account(4),spaceId:'space-001'}],
 [hash(tokens.president),{role:'super_admin',accountId:account(5),spaceId:null}]
]);
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
function fixture(){
 const settings={...structuredClone(DEFAULTS),hourlyLimit:2};
 return {schemaVersion:3,revision:7,settings,streamerSettings:{papa:structuredClone(settings),michelle:structuredClone(settings)},
  streamers:[{id:'papa',slug:'papa',active:true,display_name:'怕怕',spaceId:'space-001'},{id:'michelle',slug:'michelle',active:true,display_name:'米雪',spaceId:'space-001'},
   {id:'native',slug:'native',active:true,display_name:'Other Space private room',spaceId:'space-002'}],
  players:['P1','P2','P3'].map((playerId,index)=>({playerId,name:'Player '+playerId,ids:[['one-alias','two-alias','three-alias'][index]],names:[],password:'PRIVATE_PASSWORD',note:'PRIVATE_PROFILE_NOTE',certification:'',test:false})),
  songs:[{songId:'one',streamer_id:'papa',title:'一般歌',artist:'歌手',cat:'華語',tags:[],creditCost:1,lyrics:'PRIVATE_LYRICS'},{songId:'two',streamer_id:'papa',title:'長歌',artist:'歌手',cat:'華語',tags:[],creditCost:2,lyrics:'PRIVATE_LYRICS'},{songId:'other-room',streamer_id:'michelle',title:'另一位歌曲',artist:'歌手',tags:[],creditCost:1}],
  ledger:['P1','P2','P3'].map(playerId=>({id:'deposit-'+playerId,streamer_id:'papa',playerId,amount:20,note:'初始存歌',openingBalance:true,at:now})),
  queue:[{id:'common',streamer_id:'papa',playerId:'P3',songId:'one',title:'一般歌',artist:'歌手',kind:'saved',status:'waiting',creditCost:1,at:now,acceptedAt:now},{id:'privileged-other',streamer_id:'papa',playerId:'P2',songId:'two',title:'長歌',artist:'歌手',kind:'saved',status:'waiting',creditCost:2,at:now,acceptedAt:now}],
  crowns:[],cards:[],wishes:[],extraQuotas:[{streamer_id:'papa',player_id:'P1',space_id:'space-001',extra_quota:2,enabled:true},
   {streamer_id:'papa',player_id:'P2',space_id:'space-001',extra_quota:3,enabled:true},
   {streamer_id:'michelle',player_id:'P1',space_id:'space-001',extra_quota:4,enabled:true},
   {streamer_id:'native',player_id:'P1',space_id:'space-002',extra_quota:99,enabled:true}]};
}
function edge(source=fixture(),{grantError}={}){
 const original=structuredClone(source),calls=[],pushes=[],failed=new Set();let server=structuredClone(source),handler;
 const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date:FixedDate,Response,webpush:{},
  Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://example.test':'fixture-only'},serve:value=>handler=value},
  EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('unexpected network');}});
 vm.runInContext(stripTypeScriptTypes(bundle),context);
 function snapshot(lean,scope=null){
  const directory=server.streamers.filter(room=>!scope||room.spaceId===scope.allowed_space);
  const room=scope&&directory.find(row=>row.id===scope.requested_room||row.slug===scope.requested_room);
  if(scope&&!room)throw Error('UNKNOWN_STREAMER_SPACE');
  const rows=TABLES.flatMap(kind=>server[kind].filter(row=>!scope||kind==='players'||row.streamer_id===room.id).map((value,index)=>{
   const data=structuredClone(value);if(lean&&kind==='songs')delete data.lyrics;
   return {kind,id:String(kind==='players'?data.playerId:kind==='songs'?data.songId:data.id),data:{...data,_order:index}};
  }));
  rows.push({kind:'settings',id:'1',data:structuredClone(server.settings)},{kind:'meta',id:'1',data:{schemaVersion:3,streamers:structuredClone(directory),
   streamerSettings:Object.fromEntries(Object.entries(server.streamerSettings).filter(([id])=>directory.some(row=>row.id===id)))}});
  if(!scope)return {revision:server.revision,rows};
  const participants=new Set(server.queue.filter(q=>q.streamer_id===room.id&&q.kind==='saved'&&['completed','pending','waiting'].includes(q.status)).map(q=>q.playerId));
  const caps=server.extraQuotas.filter(q=>q.space_id===scope.allowed_space&&q.streamer_id===room.id&&(participants.has(q.player_id)||q.player_id===scope.quota_player));
  const rights=scope.quota_player?{[scope.quota_player]:server.extraQuotas.filter(q=>q.space_id===scope.allowed_space&&q.player_id===scope.quota_player&&q.enabled)
   .map(q=>({streamer_id:q.streamer_id,streamer_name:directory.find(r=>r.id===q.streamer_id).display_name,extra_quota:q.extra_quota}))}:{};
  return {revision:server.revision,rows,extraQuotas:structuredClone(caps),extraQuotaRights:rights};
 }
 context.mockApi=async(path,body,method)=>{
  calls.push({path,body:plain(body),method});
  if(path.endsWith('/papa_verified_session_actor')){
   const actor=sessions.get(body.session_hash),room=body.requested_room&&server.streamers.find(r=>r.id===body.requested_room||r.slug===body.requested_room);
   if(!actor||body.requested_room&&!room||actor.role==='streamer_admin'&&room&&actor.streamerId!==room.id||
    actor.role==='player'&&room&&actor.spaceId!==room.spaceId)return null;
   return structuredClone(actor);
  }
  if(path.endsWith('/papa_v2_scoped_read_snapshot_with_quota')||path.endsWith('/papa_v2_scoped_read_snapshot_in_space')||
   path.endsWith('/papa_v2_room_write_snapshot_with_quota')||path.endsWith('/papa_v2_room_write_snapshot_in_space'))return snapshot(true,body);
  if(path.endsWith('/papa_president_full_backup'))return {...snapshot(false,null),architecture:{formatVersion:1}};
  if(path.endsWith('/papa_v2_snapshot'))return snapshot(false,null);
  if(path.endsWith('/papa_v2_quota_snapshot')||path.endsWith('/papa_v2_read_snapshot'))throw Error('scoped quota read fell back to a legacy snapshot');
  if(path.endsWith('/papa_catalog_song_metadata_in_space'))return [];
  if(path.endsWith('/papa_manage_player_extra_quota')){
   if(grantError)throw Error(grantError);
   const ctx=body.actor_context,actor=[...sessions.values()].find(row=>row.accountId===ctx?.account_id);
   if(!actor||actor.role!==ctx.role||actor.role==='player'||ctx.space_id!=='space-001'||ctx.streamer_id!==body.requested_room||
    actor.role==='streamer_admin'&&(actor.streamerId!==body.requested_room||ctx.actor_streamer_id!==actor.streamerId))throw Error('ROOM_WRITE_ACTOR_INVALID');
   if(body.expected!==server.revision)throw Error('VERSION_CONFLICT');
   server.extraQuotas=server.extraQuotas.filter(q=>q.streamer_id!==body.requested_room||q.player_id!==body.target_player);
   server.extraQuotas.push({streamer_id:body.requested_room,player_id:body.target_player,space_id:ctx.space_id,extra_quota:body.requested_extra,enabled:body.requested_enabled&&body.requested_extra>0});
   return ++server.revision;
  }
  if(path.endsWith('/papa_room_operational_commit')||path.endsWith('/papa_room_admin_commit')||path.endsWith('/papa_release_b_commit')){
   if(body.expected!==server.revision)throw Error('VERSION_CONFLICT');
   for(const removed of body.removed)server[removed.kind]=server[removed.kind].filter(row=>String(removed.kind==='players'?row.playerId:removed.kind==='songs'?row.songId:row.id)!==removed.id);
   for(const change of body.changes){
    if(change.kind==='settings'){server.settings=structuredClone(change.data);continue;}
    if(change.kind==='meta'){Object.assign(server,structuredClone(change.data));continue;}
    const field=change.kind==='players'?'playerId':change.kind==='songs'?'songId':'id',index=server[change.kind].findIndex(row=>String(row[field])===change.id);
    if(index<0)server[change.kind].push(structuredClone(change.data));else server[change.kind][index]=structuredClone(change.data);
   }
   return ++server.revision;
  }
  if(path.endsWith('/papa_record_failed_request')){const key=JSON.stringify(body);if(failed.has(key))return false;failed.add(key);return true;}
  throw Error('unexpected database path: '+path);
 };
 context.recordPush=(room,recipients)=>pushes.push({room,recipients:plain(recipients)});
 vm.runInContext('api=async(path,body,method)=>mockApi(path,body,method);schedulePush=(room,recipients)=>recordPush(room,recipients);',context);
 const request=async(body,token=tokens.player)=>{
  const response=await handler({method:'POST',json:async()=>({token,...body})});return {status:response.status,data:await response.json()};
 };
 return {context,calls,pushes,request,get revision(){return server.revision;},state:()=>structuredClone(server),checkSource:()=>assert.deepEqual(source,original)};
}
const rpc=(h,name)=>h.calls.filter(call=>call.path.endsWith('/'+name));
const scopedSnapshots=h=>h.calls.filter(call=>/\/papa_v2_(?:scoped_read_snapshot|room_write_snapshot)(?:_with_quota|_in_space)$/.test(call.path));
const grantBody=(extra=3,enabled=true)=>({op:'mutate',streamer:'papa',revision:7,action:{type:'extraQuota',data:{player_id:'P1',extra_quota:extra,enabled}}});

test('one quota-aware snapshot binds player reads to their own identity and includes other privileged participants',async()=>{
 const h=edge(),result=await h.request({op:'read',streamer:'papa',revision:-1,profilePlayerId:'P2',role:'super_admin',playerId:'P2'});
 assert.equal(result.status,200);assert.deepEqual(rpc(h,'papa_verified_session_actor').map(call=>call.body),[{session_hash:hash(tokens.player),requested_room:'papa'}]);
 assert.deepEqual(rpc(h,'papa_v2_scoped_read_snapshot_with_quota').map(call=>call.body),[{requested_room:'papa',allowed_space:'space-001',quota_player:'P1'}]);
 assert.equal(scopedSnapshots(h).length,1);
 assert.equal(result.data.state.hourlyPersonal.commonRemaining,1);assert.equal(result.data.state.hourlyPersonal.reserved,1);
 assert.equal(result.data.state.hourlyPersonal.extraRemaining,2);assert.equal(result.data.state.hourlyPersonal.totalRemaining,3);
 assert.deepEqual(result.data.state.players.map(p=>p.playerId),['P1']);assert.deepEqual(result.data.state.players[0].quotaRights.map(q=>q.extra_quota),[2,4]);
 for(const secret of ['PRIVATE_PASSWORD','PRIVATE_PROFILE_NOTE','PRIVATE_LYRICS','Other Space private room'])assert.equal(JSON.stringify(result.data).includes(secret),false);
 assert.equal(result.data.state.players[0].quotaRights.some(right=>right.extra_quota===99),false,'identical player ID never joins rights from another Space');
 assert.equal('extraQuotas' in result.data.state,false,'other privileged participant caps only support server accounting');
 assert.equal('extraQuotaRights' in result.data.state,false,'private allowance metadata is exposed only through the authenticated player projection');
 assert.deepEqual(rpc(h,'papa_catalog_song_metadata_in_space').map(call=>call.body),[{room_id:'papa'}]);assert.equal(rpc(h,'papa_v2_snapshot').length,0);h.checkSource();
 const manager=edge();await manager.request({op:'read',streamer:'papa',profilePlayerId:'P2'},tokens.manager);
 assert.equal(rpc(manager,'papa_v2_scoped_read_snapshot_with_quota')[0].body.quota_player,'P2');
 const guest=edge();await guest.request({op:'read',streamer:'papa',profilePlayerId:'P2'},'');
 assert.deepEqual(rpc(guest,'papa_v2_scoped_read_snapshot_in_space')[0].body,{requested_room:'papa',allowed_space:'space-001'});
 assert.equal(scopedSnapshots(guest).length,1);
});

test('explicit president backup uses one authorized full export without a second snapshot or quota dependency',async()=>{
 const h=edge(),result=await h.request({op:'backup',streamer:'papa',profilePlayerId:'P2'},tokens.president);
 assert.equal(result.status,200);assert.deepEqual(rpc(h,'papa_president_full_backup').map(call=>call.body),[{subject:account(5)}]);
 assert.equal(rpc(h,'papa_v2_snapshot').length,0);assert.equal(scopedSnapshots(h).length,0);
 assert.equal(rpc(h,'papa_v2_quota_snapshot').length,0);assert.equal(result.data.backup.songs[0].lyrics,'PRIVATE_LYRICS');
 assert.equal(result.data.backup.players[0].password,'PRIVATE_PASSWORD');assert.equal(result.data.backup.architecture.formatVersion,1);h.checkSource();
});

test('grant uses one atomic architecture RPC with canonical Account context, ignoring actor and profile spoofing',async()=>{
 const h=edge(),result=await h.request({...grantBody(),profilePlayerId:'P2',role:'super_admin',account_id:'forged',session_hash:'forged',actor_context:{role:'super_admin'}},tokens.manager);
 assert.equal(result.status,200);assert.equal(result.data.state.revision,8);
 assert.deepEqual(rpc(h,'papa_v2_room_write_snapshot_with_quota').map(call=>call.body),[{requested_room:'papa',selected_song_ids:[],allowed_space:'space-001',quota_player:'P1'}]);
 assert.equal(scopedSnapshots(h).length,1);
 assert.deepEqual(rpc(h,'papa_manage_player_extra_quota').map(call=>call.body),[{expected:7,requested_room:'papa',target_player:'P1',requested_extra:3,requested_enabled:true,
  actor_context:{role:'streamer_admin',account_id:account(3),space_id:'space-001',streamer_id:'papa',actor_streamer_id:'papa'}}]);
 assert.equal(rpc(h,'papa_release_b_commit').length,0);assert.equal(rpc(h,'papa_room_admin_commit').length,0);assert.equal(rpc(h,'papa_room_operational_commit').length,0);
 assert.equal(h.pushes.length,0);assert.equal(rpc(h,'papa_catalog_song_metadata_in_space').length,1);
 assert.deepEqual(result.data.state.players.find(p=>p.playerId==='P1').quotaRights.map(q=>q.extra_quota),[4,3]);h.checkSource();
 const disabled=edge(),off=await disabled.request(grantBody(0,true),tokens.president);
 assert.equal(off.status,200);assert.equal(rpc(disabled,'papa_manage_player_extra_quota')[0].body.requested_enabled,true);
 assert.equal(disabled.state().extraQuotas.find(q=>q.streamer_id==='papa'&&q.player_id==='P1').enabled,false,'zero rights are disabled by the atomic transaction');
 assert.deepEqual(off.data.state.players.find(p=>p.playerId==='P1').quotaRights.map(q=>q.extra_quota),[4]);
});

test('invalid grants, stale revisions, player or foreign manager actors never use the grant or generic commit',async()=>{
 const cases=[
  {body:grantBody(),token:tokens.player,snapshots:0},
  {body:{...grantBody(),streamer:'michelle'},token:tokens.manager,snapshots:0},
  {body:grantBody(),token:tokens.foreign,snapshots:0},
  {body:{...grantBody(),revision:6},token:tokens.manager},
  {body:grantBody(0.5),token:tokens.manager},
  {body:grantBody(-1),token:tokens.manager},
  {body:grantBody(100001),token:tokens.manager},
  {body:grantBody(2,'true'),token:tokens.manager},
  {body:{...grantBody(),action:{type:'extraQuota',data:{player_id:'unknown',extra_quota:2,enabled:true}}},token:tokens.manager},
  {body:{...grantBody(),action:{type:'extraQuota',data:{...grantBody().action.data,accountId:'forged'}}},token:tokens.manager}
 ];
 for(const {body,token,snapshots=1} of cases){
  const h=edge(),before=h.state(),result=await h.request(body,token);assert.equal(result.status,400,JSON.stringify(body));
  assert.equal(rpc(h,'papa_manage_player_extra_quota').length,0);assert.equal(rpc(h,'papa_release_b_commit').length,0);
  assert.equal(rpc(h,'papa_room_admin_commit').length,0);assert.equal(rpc(h,'papa_room_operational_commit').length,0);
  assert.equal(scopedSnapshots(h).length,snapshots);assert.deepEqual(h.state(),before);h.checkSource();
 }
 const revoked=edge(undefined,{grantError:'ROOM_WRITE_ACTOR_INVALID'}),result=await revoked.request(grantBody(),tokens.manager);
 assert.equal(result.status,400);assert.match(result.data.error,/ROOM_WRITE_ACTOR_INVALID/);assert.equal(revoked.revision,7);
 assert.equal(rpc(revoked,'papa_manage_player_extra_quota').length,1);assert.equal(rpc(revoked,'papa_catalog_song_metadata_in_space').length,0);assert.equal(rpc(revoked,'papa_release_b_commit').length,0);
});

test('personal requests, completion and cancellation preserve the original accounting and notice pipeline',async()=>{
 const h=edge(),result=await h.request({op:'mutate',streamer:'papa',revision:h.revision,profilePlayerId:'P2',action:{type:'request',data:{songId:'two',kind:'saved'}}});
 assert.equal(result.status,200);assert.equal(result.data.state.hourlyPersonal.extraRemaining,0);assert.equal(result.data.state.hourlyPersonal.commonRemaining,1);
 const queueId=result.data.state.queue[0].id,first=rpc(h,'papa_room_operational_commit')[0].body;
 assert.equal(first.actor_context.player_id,'P1');assert.deepEqual(first.notices.map(n=>[n.recipient,n.type]).sort(),[['P1','accepted'],['__admin__','saved']]);
 assert.equal(first.actor_context.account_id,account(1));assert.equal(first.actor_context.space_id,'space-001');assert.equal(first.requested_room,'papa');
 assert.equal(first.changes.some(row=>row.kind==='ledger'),false);assert.equal(scopedSnapshots(h).length,1);
 let response=await h.request({op:'mutate',streamer:'papa',revision:h.revision,profilePlayerId:'P1',action:{type:'queue',data:{id:queueId,operation:'acknowledge',preparationMinutes:0}}},tokens.manager);
 assert.equal(response.status,200);
 response=await h.request({op:'mutate',streamer:'papa',revision:h.revision,profilePlayerId:'P1',action:{type:'queue',data:{id:queueId,operation:'complete'}}},tokens.manager);
 assert.equal(response.status,200);assert.equal(h.state().ledger.filter(row=>row.queueId===queueId&&row.amount===-2).length,1);
 assert.deepEqual(rpc(h,'papa_room_operational_commit').at(-1).body.notices.map(n=>n.type).sort(),['completed','credit']);
 response=await h.request({op:'mutate',streamer:'papa',revision:h.revision,action:{type:'request',data:{songId:'one',kind:'saved'}}});assert.equal(response.status,200);
 const cancelId=response.data.state.queue.find(q=>q.status==='waiting').id,ledger=structuredClone(h.state().ledger);
 response=await h.request({op:'mutate',streamer:'papa',revision:h.revision,action:{type:'cancelOwn',data:{id:cancelId}}});
 assert.equal(response.status,200);assert.equal(response.data.state.hourlyPersonal.commonRemaining,1);assert.deepEqual(h.state().ledger,ledger);
 assert.deepEqual(rpc(h,'papa_room_operational_commit').at(-1).body.notices.map(n=>[n.recipient,n.type]),[['__admin__','cancel']]);
 assert.equal(scopedSnapshots(h).length,5);assert.equal(rpc(h,'papa_room_operational_commit').length,5);assert.equal(rpc(h,'papa_release_b_commit').length,0);
 assert.equal(rpc(h,'papa_manage_player_extra_quota').length,0);h.checkSource();
});

test('manager saved onBehalf includes an unqueued target allowance in the same snapshot before a profile hint',async()=>{
 for(const profilePlayerId of [undefined,'P2']){
  const h=edge();assert.equal(h.state().queue.some(q=>q.playerId==='P1'),false);
  const body={op:'mutate',streamer:'papa',revision:7,action:{type:'onBehalf',data:{playerId:'P1',songId:'two',kind:'saved'}}};
  if(profilePlayerId!==undefined)body.profilePlayerId=profilePlayerId;
  const result=await h.request(body,tokens.manager);assert.equal(result.status,200);assert.equal(result.data.state.revision,8);
  assert.deepEqual(rpc(h,'papa_v2_scoped_read_snapshot_with_quota').map(call=>call.body),[{requested_room:'papa',allowed_space:'space-001',quota_player:'P1'}]);
  assert.equal(scopedSnapshots(h).length,1);assert.equal(rpc(h,'papa_catalog_song_metadata_in_space').length,1);
  assert.equal(rpc(h,'papa_v2_snapshot').length,0);assert.equal(rpc(h,'papa_v2_quota_snapshot').length,0);
  assert.equal(rpc(h,'papa_manage_player_extra_quota').length,0);assert.equal(rpc(h,'papa_room_admin_commit').length,0);assert.equal(rpc(h,'papa_release_b_commit').length,0);
  const commits=rpc(h,'papa_room_operational_commit');assert.equal(commits.length,1);
  assert.equal(commits[0].body.actor_context.account_id,account(3));assert.equal(commits[0].body.actor_context.space_id,'space-001');
  assert.equal(commits[0].body.requested_room,'papa');assert.equal(commits[0].body.changes.some(row=>row.kind==='ledger'),false);
  const requested=result.data.state.queue.find(q=>q.playerId==='P1');assert.equal(requested.kind,'saved');assert.equal(requested.status,'waiting');assert.equal(requested.creditCost,2);
  assert.equal(result.data.state.hourlyUsed,0);assert.equal(result.data.state.hourlyReserved,1);assert.equal(result.data.state.hourlyPersonal.commonRemaining,1);
  // A manager has no personal player quota. The target's allowance and the
  // immediate returned rows supply the same calculation used by the manager UI.
  assert.deepEqual(savedQuota(result.data.state,now,'P1'),{used:0,reserved:1,commonRemaining:1,extraQuota:2,personalUsed:2,extraRemaining:0,totalRemaining:1});
  assert.deepEqual(result.data.state.players.find(p=>p.playerId==='P1').quotaRights.map(q=>q.extra_quota),[2,4]);
  assert.equal(h.calls.length,4,'actor validation, one scoped snapshot, one commit and one metadata projection');h.checkSource();
 }
});

test('failed request accounting uses the authenticated player personal allowance and weighted quote',async()=>{
 const eligible=edge(),body={op:'failedRequest',streamer:'papa',songId:'two',profilePlayerId:'P2',playerId:'P2'};
 const allowed=await eligible.request(body);assert.equal(allowed.status,200);assert.equal(allowed.data.counted,false);assert.equal(rpc(eligible,'papa_record_failed_request').length,0);
 const source=fixture();source.extraQuotas=source.extraQuotas.filter(q=>q.player_id!=='P1');const full=edge(source);
 const first=await full.request(body),second=await full.request(body);assert.equal(first.data.counted,true);assert.equal(second.data.counted,false);
 const count=rpc(full,'papa_record_failed_request')[0].body;
 assert.deepEqual(count,{room_id:'papa',player_id:'P1',song_id:'two',bucket:Math.floor(Date.parse(now)/3600000)});
 assert.equal(rpc(full,'papa_release_b_commit').length,0);assert.equal(rpc(full,'papa_room_operational_commit').length,0);assert.equal(scopedSnapshots(full).length,2);
 const poor=fixture();poor.extraQuotas=[];poor.ledger.find(row=>row.playerId==='P1').amount=1;
 const insufficient=edge(poor),denied=await insufficient.request(body);assert.equal(denied.data.counted,false);assert.equal(rpc(insufficient,'papa_record_failed_request').length,0);
 full.checkSource();insufficient.checkSource();
});
