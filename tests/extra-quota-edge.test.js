import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {TABLES,DEFAULTS} from '../src/core.js';

execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
const bundle=fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
const now='2026-10-09T12:30:00Z',hash=token=>createHash('sha256').update(token).digest('hex');
const tokens={player:'player:verified-one',other:'player:verified-two',manager:'streamer:verified-papa',foreign:'streamer:verified-michelle',president:'admin:verified-president'};
const sessions=new Map([
 [hash(tokens.player),{player_id:'P1',login_id:'one-alias',role:'player'}],
 [hash(tokens.other),{player_id:'P2',login_id:'two-alias',role:'player'}],
 [hash(tokens.manager),{player_id:'__admin__',role:'streamer_admin',streamer_id:'papa'}],
 [hash(tokens.foreign),{player_id:'__admin__',role:'streamer_admin',streamer_id:'michelle'}],
 [hash(tokens.president),{player_id:'__admin__',role:'super_admin'}]
]);
const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
function fixture(){
 const settings={...structuredClone(DEFAULTS),hourlyLimit:2};
 return {schemaVersion:3,revision:7,settings,streamerSettings:{papa:structuredClone(settings),michelle:structuredClone(settings)},
  streamers:[{id:'papa',slug:'papa',active:true,display_name:'怕怕'},{id:'michelle',slug:'michelle',active:true,display_name:'米雪'}],
  players:['P1','P2','P3'].map((playerId,index)=>({playerId,name:'Player '+playerId,ids:[['one-alias','two-alias','three-alias'][index]],names:[],password:'PRIVATE_PASSWORD',note:'PRIVATE_PROFILE_NOTE',certification:'',test:false})),
  songs:[{songId:'one',streamer_id:'papa',title:'一般歌',artist:'歌手',cat:'華語',tags:[],creditCost:1,lyrics:'PRIVATE_LYRICS'},{songId:'two',streamer_id:'papa',title:'長歌',artist:'歌手',cat:'華語',tags:[],creditCost:2,lyrics:'PRIVATE_LYRICS'},{songId:'other-room',streamer_id:'michelle',title:'另一位歌曲',artist:'歌手',tags:[],creditCost:1}],
  ledger:['P1','P2','P3'].map(playerId=>({id:'deposit-'+playerId,streamer_id:'papa',playerId,amount:20,note:'初始存歌',openingBalance:true,at:now})),
  queue:[{id:'common',streamer_id:'papa',playerId:'P3',songId:'one',title:'一般歌',artist:'歌手',kind:'saved',status:'waiting',creditCost:1,at:now,acceptedAt:now},{id:'privileged-other',streamer_id:'papa',playerId:'P2',songId:'two',title:'長歌',artist:'歌手',kind:'saved',status:'waiting',creditCost:2,at:now,acceptedAt:now}],
  crowns:[],cards:[],wishes:[],extraQuotas:[{streamer_id:'papa',player_id:'P1',extra_quota:2,enabled:true},{streamer_id:'papa',player_id:'P2',extra_quota:3,enabled:true},{streamer_id:'michelle',player_id:'P1',extra_quota:4,enabled:true}]};
}
function edge(source=fixture(),{grantError}={}){
 const original=structuredClone(source),calls=[],pushes=[],failed=new Set();let server=structuredClone(source),handler;
 const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date:FixedDate,Response,
  Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://example.test':'fixture-only'},serve:value=>handler=value},
  EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('unexpected network');}});
 vm.runInContext(stripTypeScriptTypes(bundle),context);
 function snapshot(lean,quota){
  const rows=TABLES.flatMap(kind=>server[kind].map((value,index)=>{
   const data=structuredClone(value);if(lean&&kind==='songs')delete data.lyrics;
   return {kind,id:String(kind==='players'?data.playerId:kind==='songs'?data.songId:data.id),data:{...data,_order:index}};
  }));
  rows.push({kind:'settings',id:'1',data:structuredClone(server.settings)},{kind:'meta',id:'1',data:{schemaVersion:3,streamers:structuredClone(server.streamers),streamerSettings:structuredClone(server.streamerSettings)}});
  if(!quota)return {revision:server.revision,rows};
  const participants=new Set(server.queue.filter(q=>q.streamer_id===quota.requested_room&&q.kind==='saved'&&['completed','pending','waiting'].includes(q.status)).map(q=>q.playerId));
  const caps=server.extraQuotas.filter(q=>q.streamer_id===quota.requested_room&&(participants.has(q.player_id)||q.player_id===quota.target_player));
  const rights=quota.target_player?{[quota.target_player]:server.extraQuotas.filter(q=>q.player_id===quota.target_player&&q.enabled).map(q=>({streamer_id:q.streamer_id,streamer_name:server.streamers.find(r=>r.id===q.streamer_id).display_name,extra_quota:q.extra_quota}))}:{};
  return {revision:server.revision,rows,extraQuotas:structuredClone(caps),extraQuotaRights:rights};
 }
 context.mockApi=async(path,body,method)=>{
  calls.push({path,body:plain(body),method});
  if(path.includes('/papa_v2_sessions?')){const key=path.match(/token_hash=eq\.([a-f\d]{64})/)[1];return sessions.has(key)?[structuredClone(sessions.get(key))]:[];}
  if(path.includes('/papa_streamer_accounts?'))return [{streamer_id:path.includes('streamer_id=eq.michelle')?'michelle':'papa'}];
  if(path.endsWith('/papa_v2_quota_snapshot'))return snapshot(body.lean,body);
  if(path.endsWith('/papa_v2_snapshot'))return snapshot(false,null);
  if(path.endsWith('/papa_v2_read_snapshot'))throw Error('quota-aware read fell back to an extra snapshot');
  if(path.endsWith('/papa_catalog_song_metadata'))return [];
  if(path.endsWith('/papa_manage_player_extra_quota')){
   if(grantError)throw Error(grantError);
   const actor=sessions.get(body.session_hash);
   if(!actor||actor.role==='player'||actor.role==='streamer_admin'&&actor.streamer_id!==body.requested_room)throw Error('QUOTA_AUTH_INVALID');
   if(body.expected!==server.revision)throw Error('VERSION_CONFLICT');
   server.extraQuotas=server.extraQuotas.filter(q=>q.streamer_id!==body.requested_room||q.player_id!==body.target_player);
   server.extraQuotas.push({streamer_id:body.requested_room,player_id:body.target_player,extra_quota:body.requested_extra,enabled:body.requested_enabled});
   return ++server.revision;
  }
  if(path.endsWith('/papa_release_b_commit')){
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
const grantBody=(extra=3,enabled=true)=>({op:'mutate',streamer:'papa',revision:7,action:{type:'extraQuota',data:{player_id:'P1',extra_quota:extra,enabled}}});

test('one quota-aware snapshot binds player reads to their own identity and includes other privileged participants',async()=>{
 const h=edge(),result=await h.request({op:'read',streamer:'papa',revision:-1,profilePlayerId:'P2',role:'super_admin',playerId:'P2'});
 assert.equal(result.status,200);assert.deepEqual(rpc(h,'papa_v2_quota_snapshot').map(call=>call.body),[{lean:true,requested_room:'papa',target_player:'P1'}]);
 assert.equal(result.data.state.hourlyPersonal.commonRemaining,1);assert.equal(result.data.state.hourlyPersonal.reserved,1);
 assert.equal(result.data.state.hourlyPersonal.extraRemaining,2);assert.equal(result.data.state.hourlyPersonal.totalRemaining,3);
 assert.deepEqual(result.data.state.players.map(p=>p.playerId),['P1']);assert.deepEqual(result.data.state.players[0].quotaRights.map(q=>q.extra_quota),[2,4]);
 for(const secret of ['PRIVATE_PASSWORD','PRIVATE_PROFILE_NOTE','PRIVATE_LYRICS'])assert.equal(JSON.stringify(result.data).includes(secret),false);
 assert.equal(rpc(h,'papa_catalog_song_metadata').length,1);assert.equal(rpc(h,'papa_v2_snapshot').length,0);h.checkSource();
 const manager=edge();await manager.request({op:'read',streamer:'papa',profilePlayerId:'P2'},tokens.manager);
 assert.equal(rpc(manager,'papa_v2_quota_snapshot')[0].body.target_player,'P2');
 const guest=edge();await guest.request({op:'read',streamer:'papa',profilePlayerId:'P2'},'');assert.equal(rpc(guest,'papa_v2_quota_snapshot')[0].body.target_player,null);
});

test('explicit president backup keeps the original full snapshot without a quota dependency',async()=>{
 const h=edge(),result=await h.request({op:'backup',streamer:'papa',profilePlayerId:'P2'},tokens.president);
 assert.equal(result.status,200);assert.equal(rpc(h,'papa_v2_snapshot').length,1);assert.deepEqual(rpc(h,'papa_v2_snapshot')[0].body,{});
 assert.equal(rpc(h,'papa_v2_quota_snapshot').length,0);assert.equal(result.data.backup.songs[0].lyrics,'PRIVATE_LYRICS');h.checkSource();
});

test('grant uses one atomic legacy RPC with revision and hashed verified session, ignoring actor spoofing',async()=>{
 const h=edge(),result=await h.request({...grantBody(),profilePlayerId:'P2',role:'super_admin',account_id:'forged',session_hash:'forged',actor_context:{role:'super_admin'}},tokens.manager);
 assert.equal(result.status,200);assert.equal(result.data.state.revision,8);
 assert.deepEqual(rpc(h,'papa_v2_quota_snapshot').map(call=>call.body),[{lean:false,requested_room:'papa',target_player:'P1'}]);
 assert.deepEqual(rpc(h,'papa_manage_player_extra_quota').map(call=>call.body),[{expected:7,requested_room:'papa',target_player:'P1',requested_extra:3,requested_enabled:true,session_hash:hash(tokens.manager)}]);
 assert.equal(rpc(h,'papa_release_b_commit').length,0);assert.equal(h.pushes.length,0);assert.equal(rpc(h,'papa_catalog_song_metadata').length,1);
 assert.deepEqual(result.data.state.players.find(p=>p.playerId==='P1').quotaRights.map(q=>q.extra_quota),[4,3]);h.checkSource();
 const disabled=edge(),off=await disabled.request(grantBody(0,true),tokens.president);
 assert.equal(off.status,200);assert.equal(rpc(disabled,'papa_manage_player_extra_quota')[0].body.requested_enabled,false);
 assert.deepEqual(off.data.state.players.find(p=>p.playerId==='P1').quotaRights.map(q=>q.extra_quota),[4]);
});

test('invalid grants, stale revisions, player or foreign manager actors never use the grant or generic commit',async()=>{
 const cases=[
  {body:grantBody(),token:tokens.player},
  {body:{...grantBody(),streamer:'michelle'},token:tokens.manager},
  {body:{...grantBody(),revision:6},token:tokens.manager},
  {body:grantBody(0.5),token:tokens.manager},
  {body:grantBody(-1),token:tokens.manager},
  {body:grantBody(100001),token:tokens.manager},
  {body:grantBody(2,'true'),token:tokens.manager},
  {body:{...grantBody(),action:{type:'extraQuota',data:{player_id:'unknown',extra_quota:2,enabled:true}}},token:tokens.manager},
  {body:{...grantBody(),action:{type:'extraQuota',data:{...grantBody().action.data,accountId:'forged'}}},token:tokens.manager}
 ];
 for(const {body,token} of cases){
  const h=edge(),before=h.state(),result=await h.request(body,token);assert.equal(result.status,400,JSON.stringify(body));
  assert.equal(rpc(h,'papa_manage_player_extra_quota').length,0);assert.equal(rpc(h,'papa_release_b_commit').length,0);
  assert.equal(rpc(h,'papa_v2_quota_snapshot').length,1);assert.deepEqual(h.state(),before);h.checkSource();
 }
 const revoked=edge(undefined,{grantError:'QUOTA_AUTH_INVALID'}),result=await revoked.request(grantBody(),tokens.manager);
 assert.equal(result.status,400);assert.match(result.data.error,/QUOTA_AUTH_INVALID/);assert.equal(revoked.revision,7);
 assert.equal(rpc(revoked,'papa_manage_player_extra_quota').length,1);assert.equal(rpc(revoked,'papa_catalog_song_metadata').length,0);assert.equal(rpc(revoked,'papa_release_b_commit').length,0);
});

test('personal requests, completion and cancellation preserve the original accounting and notice pipeline',async()=>{
 const h=edge(),result=await h.request({op:'mutate',streamer:'papa',revision:h.revision,profilePlayerId:'P2',action:{type:'request',data:{songId:'two',kind:'saved'}}});
 assert.equal(result.status,200);assert.equal(result.data.state.hourlyPersonal.extraRemaining,0);assert.equal(result.data.state.hourlyPersonal.commonRemaining,1);
 const queueId=result.data.state.queue[0].id,first=rpc(h,'papa_release_b_commit')[0].body;
 assert.equal(first.actor_context.player_id,'P1');assert.deepEqual(first.notices.map(n=>[n.recipient,n.type]).sort(),[['P1','accepted'],['__admin__','saved']]);
 assert.equal(first.changes.some(row=>row.kind==='ledger'),false);assert.equal(rpc(h,'papa_v2_quota_snapshot').length,1);
 let response=await h.request({op:'mutate',streamer:'papa',revision:h.revision,profilePlayerId:'P1',action:{type:'queue',data:{id:queueId,operation:'acknowledge',preparationMinutes:0}}},tokens.manager);
 assert.equal(response.status,200);
 response=await h.request({op:'mutate',streamer:'papa',revision:h.revision,profilePlayerId:'P1',action:{type:'queue',data:{id:queueId,operation:'complete'}}},tokens.manager);
 assert.equal(response.status,200);assert.equal(h.state().ledger.filter(row=>row.queueId===queueId&&row.amount===-2).length,1);
 assert.deepEqual(rpc(h,'papa_release_b_commit').at(-1).body.notices.map(n=>n.type).sort(),['completed','credit']);
 response=await h.request({op:'mutate',streamer:'papa',revision:h.revision,action:{type:'request',data:{songId:'one',kind:'saved'}}});assert.equal(response.status,200);
 const cancelId=response.data.state.queue.find(q=>q.status==='waiting').id,ledger=structuredClone(h.state().ledger);
 response=await h.request({op:'mutate',streamer:'papa',revision:h.revision,action:{type:'cancelOwn',data:{id:cancelId}}});
 assert.equal(response.status,200);assert.equal(response.data.state.hourlyPersonal.commonRemaining,1);assert.deepEqual(h.state().ledger,ledger);
 assert.deepEqual(rpc(h,'papa_release_b_commit').at(-1).body.notices.map(n=>[n.recipient,n.type]),[['__admin__','cancel']]);
 assert.equal(rpc(h,'papa_v2_quota_snapshot').length,5);assert.equal(rpc(h,'papa_manage_player_extra_quota').length,0);h.checkSource();
});

test('failed request accounting uses the authenticated player personal allowance and weighted quote',async()=>{
 const eligible=edge(),body={op:'failedRequest',streamer:'papa',songId:'two',profilePlayerId:'P2',playerId:'P2'};
 const allowed=await eligible.request(body);assert.equal(allowed.status,200);assert.equal(allowed.data.counted,false);assert.equal(rpc(eligible,'papa_record_failed_request').length,0);
 const source=fixture();source.extraQuotas=source.extraQuotas.filter(q=>q.player_id!=='P1');const full=edge(source);
 const first=await full.request(body),second=await full.request(body);assert.equal(first.data.counted,true);assert.equal(second.data.counted,false);
 const count=rpc(full,'papa_record_failed_request')[0].body;
 assert.deepEqual(count,{room_id:'papa',player_id:'P1',song_id:'two',bucket:Math.floor(Date.parse(now)/3600000)});
 assert.equal(rpc(full,'papa_release_b_commit').length,0);assert.equal(rpc(full,'papa_v2_quota_snapshot').length,2);
 const poor=fixture();poor.extraQuotas=[];poor.ledger.find(row=>row.playerId==='P1').amount=1;
 const insufficient=edge(poor),denied=await insufficient.request(body);assert.equal(denied.data.counted,false);assert.equal(rpc(insufficient,'papa_record_failed_request').length,0);
 full.checkSource();insufficient.checkSource();
});
