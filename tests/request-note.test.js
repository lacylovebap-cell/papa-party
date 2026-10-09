import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate,scopeState,publicView,balance,reservedCredits,reservedHour,usedHour,captureMutationIds,replayMutationIds} from '../src/core.js';

const admin={role:'admin'},now='2026-10-09T12:30:00Z',past='2026-10-09T11:30:00Z';
const run=(s,type,data,who=admin,at=now,streamer='papa')=>mutate(s,{type,data,streamer},who,at);
const player=(s,index=0)=>({role:'player',playerId:s.players[index].playerId,loginId:s.players[index].ids[0]});
const scoped=s=>scopeState(s,'papa');
function fixture(){
 let s=run(empty(),'player',{name:'備註玩家',ids:['note-player'],balance:20});
 s=run(s,'player',{name:'其他玩家',ids:['other-player'],balance:5});s=run(s,'settings',{hourlyLimit:20});
 for(const [title,creditCost] of [['一般歌',1],['長歌',2],['半首歌',0.5]])s=run(s,'song',{title,artist:'歌手',creditCost});
 return s;
}
function request(s,extra={},index=0,kind='saved',who=player(s)){
 return run(s,'request',{songId:s.songs[index].songId,kind,giftConfirmed:true,...extra},who);
}
const op=(s,id,operation,extra={})=>run(s,'queue',{id,operation,...extra});
function complete(s,id){
 const q=s.queue.find(row=>row.id===id);
 s=op(s,id,q.status==='pending'?'approve':'acknowledge',{preparationMinutes:0});
 return op(s,id,'complete');
}
function unchangedFailure(s,mutation,pattern=/點歌備註/){const before=structuredClone(s);assert.throws(mutation,pattern);assert.deepEqual(s,before);}

test('request notes trim optional text and accept exactly thirty Chinese or emoji codepoints',()=>{
 for(const value of ['歌'.repeat(30),'😀'.repeat(30),'中😀'.repeat(15)]){
  const s=request(fixture(),{requestNote:'  '+value+'  '}),q=s.queue[0];
  assert.equal(q.requestNote,value);assert.equal([...q.requestNote].length,30);
  assert.equal(q.creditCost,1);assert.equal(q.status,'waiting');
 }
 for(const data of [{},{requestNote:undefined},{requestNote:''},{requestNote:' 　'}]){
  const s=request(fixture(),data);assert.equal(Object.hasOwn(s.queue[0],'requestNote'),false);
 }
});

test('forged long, nonstring, control and multiline notes reject saved and live requests atomically',()=>{
 const values=[
  '歌'.repeat(31),'😀'.repeat(31),null,false,0,[],{},new String('text'),
  '第一行\n第二行','文字\n','\r文字','a\tb','a\u0000b','a\u001bb','a\u007fb','a\u0085b','a\u2028b','a\u2029b'
 ];
 for(const kind of ['saved','live'])for(const requestNote of values){
  const s=fixture();unchangedFailure(s,()=>request(s,{requestNote},0,kind));
 }
});

test('quotes and HTML-looking text remain ordinary queue data and never become song metadata',()=>{
 for(const requestNote of ["<script>alert('x')</script>",'想聽「這首」 & <另一首> / !?']){
  const source=fixture(),songs=structuredClone(source.songs),s=request(source,{requestNote,note:'FORGED_PRIVATE_NOTE'});
  assert.equal(s.queue[0].requestNote,requestNote);assert.equal(Object.hasOwn(s.queue[0],'note'),false);
  assert.deepEqual(s.songs,songs);assert.equal(s.songs.some(row=>Object.hasOwn(row,'requestNote')),false);
  assert.equal(publicView(s,player(s),now).queue[0].requestNote,requestNote,'the display layer must escape this plain text');
 }
});

test('a note changes no request identity, fee, quote, reservation, quota or venue accounting',()=>{
 let source=run(fixture(),'settings',{radio_enabled:true,current_space:'radio'});
 source=run(source,'ledger',{playerId:player(source).playerId,amount:1,storage_pool:'radio'});
 for(const kind of ['saved','live'])for(const index of [0,1,2]){
  const baseline=captureMutationIds(()=>request(source,{},index,kind));
  const noted=replayMutationIds(baseline.ids,()=>request(source,{requestNote:'我的 30 字以內備註'},index,kind));
  assert.equal(baseline.ids.length,1);assert.equal(noted.queue[0].id,baseline.value.queue[0].id);
  const comparison=structuredClone(noted);delete comparison.queue[0].requestNote;
  assert.deepEqual(comparison,baseline.value);
  for(const pool of ['shengma','radio']){
   assert.equal(balance(scoped(noted),player(noted).playerId,pool),balance(scoped(baseline.value),player(source).playerId,pool));
   assert.equal(reservedCredits(scoped(noted),player(noted).playerId,pool),reservedCredits(scoped(baseline.value),player(source).playerId,pool));
  }
  assert.equal(reservedHour(scoped(noted),now),reservedHour(scoped(baseline.value),now));
 }
});

test('manager on-behalf private notes stay separate and never implicitly create a request note',()=>{
 const source=fixture(),common={playerId:player(source).playerId,songId:source.songs[0].songId,kind:'saved',note:'  私人行政備註  ',effective_at:past};
 let s=run(source,'onBehalf',common);assert.equal(s.queue[0].note,'私人行政備註');assert.equal(Object.hasOwn(s.queue[0],'requestNote'),false);
 s=run(source,'onBehalf',{...common,requestNote:'  玩家點歌備註  ',completed:true});
 assert.equal(s.queue[0].requestNote,'玩家點歌備註');assert.equal(s.queue[0].note,'私人行政備註');assert.equal(s.queue[0].status,'completed');
 assert.equal(s.queue[0].created_at,now);assert.equal(s.queue[0].completedAt,new Date(past).toISOString());
 unchangedFailure(source,()=>run(source,'onBehalf',{...common,requestNote:'長'.repeat(31)}));
});

test('existing song, administrative note and time edits retain the immutable player request note',()=>{
 let s=request(fixture(),{requestNote:'原點歌備註'}),id=s.queue[0].id;
 s=op(s,id,'edit',{songId:s.songs[1].songId,note:'另外的行政備註',at:past});
 assert.equal(s.queue[0].requestNote,'原點歌備註');assert.equal(s.queue[0].note,'另外的行政備註');assert.equal(s.queue[0].creditCost,2);
 for(const requestNote of ['取代原文字','原點歌備註',undefined,null])unchangedFailure(s,()=>op(s,id,'edit',{requestNote}),/只能修改/);
 s=complete(s,id);assert.equal(s.queue[0].requestNote,'原點歌備註');assert.equal(balance(scoped(s),player(s).playerId),18);
 s=run(s,'recordTime',{table:'queue',id,times:{completedAt:past},note:'歷史行政備註'});
 assert.equal(s.queue[0].requestNote,'原點歌備註');assert.equal(s.queue[0].note,'歷史行政備註');assert.equal(balance(scoped(s),player(s).playerId),18);
});

test('cancellation and completed history retain notes without adding credits or changing existing guards',()=>{
 let s=request(fixture(),{requestNote:'取消也保留'}),id=s.queue[0].id,ledger=structuredClone(s.ledger);
 s=run(s,'cancelOwn',{id},player(s));assert.equal(s.queue[0].status,'cancelled');assert.equal(s.queue[0].requestNote,'取消也保留');
 assert.deepEqual(s.ledger,ledger);assert.equal(balance(scoped(s),player(s).playerId),20);assert.equal(reservedCredits(scoped(s),player(s).playerId),0);
 let completed=request(fixture(),{requestNote:'完成也保留'});completed=complete(completed,completed.queue[0].id);
 assert.equal(completed.queue[0].requestNote,'完成也保留');assert.equal(usedHour(scoped(completed),now),1);assert.equal(balance(scoped(completed),player(completed).playerId),19);
 const paused=run(fixture(),'settings',{status:'暫停點歌'});unchangedFailure(paused,()=>request(paused,{requestNote:'不繞過暫停'}),/休息/);
 const archived=fixture();archived.players[0].archived=true;unchangedFailure(archived,()=>request(archived,{requestNote:'不繞過封存'}),/玩家已封存/);
 const normal=fixture();unchangedFailure(normal,()=>request(normal,{requestNote:'不繞過場域',venue:'radio'}),/場域|電台|玩家/);
});

test('public queue notes stay restricted to the requesting player and selected room',()=>{
 let s=request(fixture(),{requestNote:'PLAYER_ONE_PRIVATE_REQUEST'});
 s=request(s,{requestNote:'PLAYER_TWO_PRIVATE_REQUEST'},0,'live',player(s,1));
 s=run(s,'streamer',{slug:'other',display_name:'另一位'});s=run(s,'song',{title:'另一位歌曲',artist:'歌手'},admin,now,'other');
 s=run(s,'request',{songId:scopeState(s,'other').songs[0].songId,kind:'live',giftConfirmed:true,requestNote:'OTHER_ROOM_PRIVATE_REQUEST'},player(s),now,'other');
 const own=publicView(s,player(s),now),other=publicView(s,player(s,1),now),guest=publicView(s,null,now);
 assert.deepEqual(own.queue.map(row=>row.requestNote),['PLAYER_ONE_PRIVATE_REQUEST']);assert.deepEqual(other.queue.map(row=>row.requestNote),['PLAYER_TWO_PRIVATE_REQUEST']);
 assert.equal(guest.queue.length,0);
 assert.equal(JSON.stringify(own).includes('PLAYER_TWO_PRIVATE_REQUEST'),false);assert.equal(JSON.stringify(own).includes('OTHER_ROOM_PRIVATE_REQUEST'),false);
 assert.equal(JSON.stringify(guest).includes('PRIVATE_REQUEST'),false);assert.equal(publicView(s,admin,now).queue.length,2);
});
