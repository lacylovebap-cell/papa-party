import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture} from './support/native-space-fixture.js';

test('a new independent Space can be activated and its streamer can log in and read her own room',async t=>{
 const f=await nativeFixture(t);
 const fairy=await f.provision({name:'仙女',slug:'fairy',password:'fairy-pass-1'});
 assert.equal(fairy.spaceCreated,true);
 // Not open yet: login explains why instead of pretending the password is wrong.
 let attempt=await f.call({op:'streamerLogin',streamer:'fairy',password:'fairy-pass-1'});
 assert.equal(attempt.status,400);assert.match(attempt.body.error,/尚未開放/);
 const activated=await f.setSpaceStatus(fairy.spaceId,'restore');
 assert.equal(activated.status,200,JSON.stringify(activated.body));
 assert.equal((await f.spaceRow(fairy.spaceId)).status,'active');
 attempt=await f.call({op:'streamerLogin',streamer:'fairy',password:'wrong-pass'});assert.equal(attempt.status,400);
 attempt=await f.call({op:'streamerLogin',streamer:'fairy',password:'fairy-pass-1'});
 assert.equal(attempt.status,200,JSON.stringify(attempt.body));
 const token=attempt.body.token;
 const read=await f.call({op:'read',streamer:'fairy'},token);
 assert.equal(read.status,200,JSON.stringify(read.body));
 assert.equal(read.body.state.currentStreamer.id,fairy.streamerId);
 assert.equal(read.body.state.currentStreamer.spaceId,fairy.spaceId);
});

test('readiness shows whether the price list has amounts, without blocking 開放營運',async t=>{
 const f=await nativeFixture(t);
 const fairy=await f.provision({name:'仙女',slug:'fairy',password:'fairy-pass-1'});
 const readiness=async()=>{const r=await f.call({op:'platformSpaceReadiness',spaceId:fairy.spaceId,token:f.president.token});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 let r=await readiness();
 assert.deepEqual(r.items.map(i=>[i.code,i.done]),[['streamer',true],['login',true],['pricing',false],['operations',false],['route',false]]);
 assert.equal(r.canActivate,true,'missing amounts never block opening');
 assert.match(r.items.find(i=>i.code==='pricing').detail,/顯示 0/);
 const base={v:1,mode:'none',singleFee:'host',names:{singer:'仙女',host:'主持',hall:'廳主號'},unit:'星星',perUnit:{singer:0,host:0,hall:0},policy:'auto',plans:[],tiers:[]};
 const save=async(pricing,expectedRevision)=>{const s=await f.call({op:'platformSpacePricingSave',operationId:crypto.randomUUID(),spaceId:fairy.spaceId,expectedRevision,rolloverHour:20,pricing,token:f.president.token});assert.equal(s.status,200,JSON.stringify(s.body));};
 await save(base,0);
 assert.equal((await readiness()).items.find(i=>i.code==='pricing').done,false,'a list of zeros is not filled in');
 await save({...base,perUnit:{singer:300,host:0,hall:0}},1);
 const priced=(await readiness()).items.find(i=>i.code==='pricing');
 assert.equal(priced.done,true);assert.match(priced.detail,/20:00/);
});

async function openFairy(f){
 const fairy=await f.provision({name:'仙女',slug:'fairy',password:'fairy-pass-1'});
 const opened=await f.setSpaceStatus(fairy.spaceId,'restore');assert.equal(opened.status,200,JSON.stringify(opened.body));
 const login=await f.call({op:'streamerLogin',streamer:'fairy',password:'fairy-pass-1'});assert.equal(login.status,200,JSON.stringify(login.body));
 return {...fairy,token:login.body.token};
}

test('a new Space starts with a blank plan and stays isolated from 聲瑪 in both directions',async t=>{
 const f=await nativeFixture(t);
 const shengma=await f.fingerprint();
 const fairy=await openFairy(f);
 const own=await f.call({op:'read',streamer:'fairy'},fairy.token);
 const settings=own.body.state.settings;
 assert.equal(settings.livePrice,0);assert.equal(settings.liveDouble,0);assert.equal(settings.crownDouble,0);
 assert.deepEqual(settings.plans,[]);assert.ok(settings.tiers.length===0);
 // Her login cannot open 聲瑪's room, and a 聲瑪 room is never served under her Space.
 const foreign=await f.call({op:'read',streamer:'papa'},fairy.token);assert.equal(foreign.status,400);
 const spoof=await f.call({op:'read',streamer:'papa',spaceId:fairy.spaceId});assert.equal(spoof.status,400);
 // Visitors may read an open Space when they name it; 聲瑪 reads are unchanged.
 const visitor=await f.call({op:'read',streamer:'fairy',spaceId:fairy.spaceId});
 assert.equal(visitor.status,200,JSON.stringify(visitor.body));assert.equal(visitor.body.state.currentStreamer.id,fairy.streamerId);
 assert.equal((await f.call({op:'read',streamer:'papa'})).status,200);
 // The legacy whole-platform paths stay closed to the new Space.
 for(const body of [{op:'search',streamer:'fairy',query:'a'},{op:'migrate',streamer:'fairy'}]){
  const r=await f.call(body,fairy.token);assert.equal(r.status,400,JSON.stringify([body,r.body]));
 }
 assert.equal(await f.fingerprint(),shengma,'聲瑪 rows untouched');
});

test('a suspended new Space is not served to visitors even when its id is named',async t=>{
 const f=await nativeFixture(t);
 const fairy=await f.provision({name:'仙女',slug:'fairy',password:'fairy-pass-1'});
 const r=await f.call({op:'read',streamer:'fairy',spaceId:fairy.spaceId});
 assert.equal(r.status,400,JSON.stringify(r.body));
});

test('the new streamer edits her own settings and songbook; only her Space changes',async t=>{
 const f=await nativeFixture(t);
 const shengma=await f.fingerprint();
 const fairy=await openFairy(f);
 let view=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state;
 const saved=await f.call({op:'mutate',streamer:'fairy',revision:view.revision,action:{type:'settings',data:{...view.settings,livePrice:1000,opening:'21:00～23:00'}}},fairy.token);
 assert.equal(saved.status,200,JSON.stringify(saved.body));
 view=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state;
 assert.equal(view.settings.livePrice,1000);assert.equal(view.settings.opening,'21:00～23:00');
 const song=await f.call({op:'mutate',streamer:'fairy',revision:view.revision,action:{type:'song',data:{title:'仙女的歌',artist:'仙女'}}},fairy.token);
 assert.equal(song.status,200,JSON.stringify(song.body));
 view=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state;
 assert.deepEqual(view.songs.map(x=>x.title),['仙女的歌']);
 const rows=await f.q("select kind,space_id,data->>'streamer_id' streamer_id from papa_v2_entities where kind='songs' and data->>'title'='仙女的歌'");
 assert.deepEqual(rows,[{kind:'songs',space_id:fairy.spaceId,streamer_id:fairy.streamerId}]);
 const papa=(await f.call({op:'read',streamer:'papa'})).body.state;
 assert.ok(!papa.songs.some(x=>x.title==='仙女的歌'));
 assert.equal(await f.fingerprint(),shengma,'聲瑪 rows untouched');
});

test('her admin pages (players, new practice, song search, history, accounting, sync) only see her own Space',async t=>{
 const f=await nativeFixture(t);
 const fairy=await openFairy(f);
 let view=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state;
 await f.call({op:'mutate',streamer:'fairy',revision:view.revision,action:{type:'song',data:{title:'聲瑪的歌',artist:'Artist'}}},fairy.token);
 const players=await f.call({op:'playerManagementPage',streamer:'fairy',mode:'all',query:'',page:0,limit:20},fairy.token);
 assert.equal(players.status,200,JSON.stringify(players.body));
 assert.ok(!JSON.stringify(players.body).includes('聲瑪玩家'),'聲瑪 players are not listed');
 const practice=await f.call({op:'newPracticePage',streamer:'fairy',management:true,page:0,limit:20},fairy.token);
 assert.equal(practice.status,200,JSON.stringify(practice.body));
 const search=await f.call({op:'songSearch',streamer:'fairy',query:'聲瑪'},fairy.token);
 assert.equal(search.status,200,JSON.stringify(search.body));
 for(const song of search.body.songs)assert.notEqual(song.streamer_id||song.streamerId,'papa');
 const accounting=await f.call({op:'accountingSummary',streamer:'fairy',management:true,day:'2026-10-28'},fairy.token);
 assert.equal(accounting.status,200,JSON.stringify(accounting.body));
 const sync=await f.call({op:'roomSyncHead',streamer:fairy.streamerId,spaceId:fairy.spaceId},fairy.token);
 assert.equal(sync.status,200,JSON.stringify(sync.body));
 const history=await f.call({op:'listeningHistoryPage',streamer:'fairy',playerId:'P1',page:0,limit:20},fairy.token);
 assert.equal(history.status,400,'a 聲瑪 player is not found in her Space');
 // 聲瑪's own pages are unchanged for the president.
 const shengma=await f.call({op:'playerManagementPage',streamer:'papa',mode:'all',query:'',page:0,limit:20},f.president.token);
 assert.equal(shengma.status,200,JSON.stringify(shengma.body));assert.ok(JSON.stringify(shengma.body).includes('聲瑪玩家'));
 // The president can open her room by naming her Space.
 const presidentView=await f.call({op:'read',streamer:'fairy',spaceId:fairy.spaceId},f.president.token);
 assert.equal(presidentView.status,200,JSON.stringify(presidentView.body));
});

async function fairyWithSong(f){
 const fairy=await openFairy(f);
 let view=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state;
 const added=await f.call({op:'mutate',streamer:'fairy',revision:view.revision,action:{type:'song',data:{title:'仙女的歌',artist:'仙女'}}},fairy.token);
 assert.equal(added.status,200,JSON.stringify(added.body));
 view=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state;
 return {...fairy,view,songId:view.songs[0].songId};
}
const createPlayer=(f,fairy,revision,{name='小粉絲',loginCode='fan-1',password='fan-pass-1',ids='tt-123'}={},token=fairy.token)=>
 f.call({op:'spacePlayerCreate',streamer:'fairy',revision,name,loginCode,password,ids},token);

test('her own player list: she adds a player with a login code; that player logs in only to her Space and requests a song',async t=>{
 const f=await nativeFixture(t);
 const shengma=await f.fingerprint();
 const fairy=await fairyWithSong(f);
 const created=await createPlayer(f,fairy,fairy.view.revision);
 assert.equal(created.status,200,JSON.stringify(created.body));
 assert.equal(created.body.loginCode,'fan-1');
 const [profile]=await f.q('select space_id,data from papa_space_player_profiles where player_id=$1',[created.body.playerId]);
 assert.equal(profile.space_id,fairy.spaceId);assert.equal(profile.data.name,'小粉絲');assert.ok(!('password' in profile.data));
 const [credential]=await f.q('select login_code,password_hash from papa_space_player_credentials where player_id=$1',[created.body.playerId]);
 assert.equal(credential.login_code,'fan-1');assert.match(credential.password_hash,/^\$2[aby]\$/);
 // Wrong password, wrong Space and a 聲瑪 login are all refused.
 assert.equal((await f.call({op:'spacePlayerLogin',streamer:'fairy',loginCode:'fan-1',password:'nope-nope'})).status,400);
 assert.equal((await f.call({op:'spacePlayerLogin',streamer:'papa',loginCode:'fan-1',password:'fan-pass-1'})).status,400);
 assert.equal((await f.call({op:'login',streamer:'fairy',playerId:'P1',password:'p1-pass'})).status,400);
 const login=await f.call({op:'spacePlayerLogin',streamer:'fairy',loginCode:'FAN-1',password:'fan-pass-1'});
 assert.equal(login.status,200,JSON.stringify(login.body));
 assert.equal(login.body.spaceId,fairy.spaceId);assert.equal(login.body.playerId,created.body.playerId);
 const player=login.body.token;
 const own=await f.call({op:'read',streamer:'fairy'},player);
 assert.equal(own.status,200,JSON.stringify(own.body));assert.equal(own.body.state.currentStreamer.id,fairy.streamerId);
 assert.equal((await f.call({op:'read',streamer:'papa'},player)).status,400,'her player cannot open 聲瑪');
 const request=await f.call({op:'mutate',streamer:'fairy',revision:own.body.state.revision,operationId:crypto.randomUUID(),
  action:{type:'request',data:{songId:fairy.songId,kind:'live',giftConfirmed:true}}},player);
 assert.equal(request.status,200,JSON.stringify(request.body));
 const queue=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state.queue;
 assert.equal(queue.length,1);assert.equal(queue[0].playerId,created.body.playerId);
 const [row]=await f.q("select space_id from papa_v2_entities where kind='queue'");assert.equal(row.space_id,fairy.spaceId);
 assert.equal(await f.fingerprint(),shengma,'聲瑪 rows untouched');
});

test('player codes are unique per Space; removing a player stops the login; hall streamers cannot manage players',async t=>{
 const f=await nativeFixture(t);
 const fairy=await fairyWithSong(f);
 const first=await createPlayer(f,fairy,fairy.view.revision);assert.equal(first.status,200,JSON.stringify(first.body));
 let revision=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state.revision;
 const duplicate=await createPlayer(f,fairy,revision,{name:'別人',ids:'tt-999'});
 assert.equal(duplicate.status,400);assert.match(duplicate.body.error,/已有人使用/);
 const changed=await f.call({op:'spacePlayerAccess',streamer:'fairy',playerId:first.body.playerId,password:'new-pass-2'},fairy.token);
 assert.equal(changed.status,200,JSON.stringify(changed.body));
 assert.equal((await f.call({op:'spacePlayerLogin',streamer:'fairy',loginCode:'fan-1',password:'fan-pass-1'})).status,400);
 const login=await f.call({op:'spacePlayerLogin',streamer:'fairy',loginCode:'fan-1',password:'new-pass-2'});assert.equal(login.status,200);
 revision=(await f.call({op:'read',streamer:'fairy'},fairy.token)).body.state.revision;
 const removed=await f.call({op:'spacePlayerAccess',streamer:'fairy',playerId:first.body.playerId,remove:true,revision},fairy.token);
 assert.equal(removed.status,200,JSON.stringify(removed.body));
 assert.equal((await f.call({op:'read',streamer:'fairy'},login.body.token)).status,400,'removed player session ended');
 assert.equal((await f.call({op:'spacePlayerLogin',streamer:'fairy',loginCode:'fan-1',password:'new-pass-2'})).status,400);
 // A hall streamer may not add players; the president may.
 const hall=await f.call({op:'platformManageSpace',operationId:crypto.randomUUID(),action:'create',payload:{name:'星光廳',kind:'hall'}},f.president.token);
 assert.equal(hall.status,200,JSON.stringify(hall.body));
 const host=await f.provision({mode:'streamer',spaceId:hall.body.id,name:'星星',slug:'star',password:'star-pass-1'});
 assert.equal((await f.setSpaceStatus(hall.body.id,'restore')).status,200);
 const star=(await f.call({op:'streamerLogin',streamer:'star',password:'star-pass-1'})).body.token;
 const starView=(await f.call({op:'read',streamer:'star'},star)).body.state;
 const denied=await f.call({op:'spacePlayerCreate',streamer:'star',revision:starView.revision,name:'粉',loginCode:'fan-9',password:'fan-pass-9'},star);
 assert.equal(denied.status,400);assert.match(denied.body.error,/獨立主播或總裁/);
 const byPresident=await f.call({op:'spacePlayerCreate',streamer:'star',revision:starView.revision,name:'粉',loginCode:'fan-9',password:'fan-pass-9'},f.president.token);
 assert.equal(byPresident.status,200,JSON.stringify(byPresident.body));
 assert.equal(host.spaceCreated,false);
});

test('visitors and the president open a new Space room by its name alone; the website picker lists only open Spaces',async t=>{
 const f=await nativeFixture(t);
 const fairy=await f.provision({name:'仙女',slug:'fairy',password:'fairy-pass-1'});
 let portal=await f.call({op:'portalDirectory'});
 assert.equal(portal.status,200);assert.ok(portal.body.spaces.some(s=>s.id==='space-001'&&s.kind==='hall'&&s.streamers.some(r=>r.slug==='papa')),'聲瑪 is listed as a hall');
 assert.ok(!portal.body.spaces.some(s=>s.id===fairy.spaceId),'a Space that is not open is not listed');
 assert.equal((await f.call({op:'read',streamer:'fairy'})).status,400,'not open: not served');
 assert.equal((await f.setSpaceStatus(fairy.spaceId,'restore')).status,200);
 portal=await f.call({op:'portalDirectory'});
 const listed=portal.body.spaces.find(s=>s.id===fairy.spaceId);
 assert.deepEqual(listed,{id:fairy.spaceId,name:'仙女',kind:'independent',streamers:[{slug:'fairy',name:'仙女'}]});
 assert.deepEqual(Object.keys(portal.body.spaces[0]).sort(),['id','kind','name','streamers'],'names only');
 const visitor=await f.call({op:'read',streamer:'fairy'});
 assert.equal(visitor.status,200,JSON.stringify(visitor.body));assert.equal(visitor.body.state.currentStreamer.spaceId,fairy.spaceId);
 const president=await f.call({op:'read',streamer:'fairy'},f.president.token);
 assert.equal(president.status,200,JSON.stringify(president.body));assert.equal(president.body.state.currentStreamer.id,fairy.streamerId);
 assert.equal((await f.call({op:'read',streamer:'papa'})).status,200,'聲瑪 visitors unchanged');
});

test('device login works for a new Space streamer and her player; messages say they open in the next stage',async t=>{
 const f=await nativeFixture(t);
 const fairy=await openFairy(f);
 const device=async(token)=>{const start=await f.call({op:'deviceStart',token,installationId:crypto.randomUUID(),platform:'web',appVersion:'space-foundation-1008',streamer:'fairy'});
  assert.equal(start.status,200,JSON.stringify(start.body));const r=await f.call({op:'deviceRefresh',sessionId:start.body.sessionId,refreshToken:start.body.refreshToken});assert.equal(r.status,200);return r.body.token;};
 const manager=await device(fairy.token);
 let view=(await f.call({op:'read',streamer:'fairy'},manager)).body.state;
 await f.call({op:'mutate',streamer:'fairy',revision:view.revision,action:{type:'song',data:{title:'仙女的歌',artist:'仙女'}}},manager);
 view=(await f.call({op:'read',streamer:'fairy'},manager)).body.state;
 const logins=await f.call({op:'spacePlayerLogins',streamer:'fairy'},manager);
 assert.deepEqual(logins.body,{logins:[],canManage:true});
 const created=await f.call({op:'spacePlayerCreate',streamer:'fairy',revision:view.revision,name:'小粉絲',loginCode:'fan-1',password:'fan-pass-1',ids:'tt-1'},manager);
 assert.equal(created.status,200,JSON.stringify(created.body));
 assert.deepEqual((await f.call({op:'spacePlayerLogins',streamer:'fairy'},manager)).body.logins,[{playerId:created.body.playerId,loginCode:'fan-1',enabled:true}]);
 const login=await f.call({op:'spacePlayerLogin',streamer:'fairy',loginCode:'fan-1',password:'fan-pass-1'});
 const player=await device(login.body.token);
 const own=await f.call({op:'read',streamer:'fairy'},player);
 assert.equal(own.status,200);assert.equal(own.body.sessionIdentity.spaceId,fairy.spaceId);assert.equal(own.body.sessionIdentity.playerId,created.body.playerId);
 const request=await f.call({op:'mutate',streamer:'fairy',revision:own.body.state.revision,operationId:crypto.randomUUID(),action:{type:'request',data:{songId:view.songs[0].songId,kind:'live',giftConfirmed:true}}},player);
 assert.equal(request.status,200,JSON.stringify(request.body));
 const notices=await f.call({op:'messageCenterCounts',streamer:'fairy',management:true},manager);
 assert.equal(notices.status,400);assert.match(notices.body.error,/下一階段開放/);
});
