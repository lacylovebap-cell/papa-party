import test from 'node:test';import assert from 'node:assert/strict';
import {isSuper,coreActor,authorizeManagerOperation,managementView,noticeIdentity,canReplaceSound,validNoticeAudio} from '../src/access-policy.js';
const streamer={role:'streamer_admin',streamer_id:'a'},superAdmin={role:'super_admin'},player={role:'player',playerId:'p'};
test('notification ownership comes from role and bound room, never requested recipient',()=>{
 assert.deepEqual(noticeIdentity(superAdmin,'b'),{room:'__global__',recipient:'__super__'});
 assert.deepEqual(noticeIdentity(streamer,'a'),{room:'a',recipient:'__admin__'});
 assert.deepEqual(noticeIdentity(player,'a'),{room:'a',recipient:'p'});
 assert.throws(()=>noticeIdentity(streamer,'b'));assert.throws(()=>noticeIdentity(null,'a'));
});
test('streamer can operate own songs and queues, cannot switch room or run global operations',()=>{
 for(const type of ['song','queue','ledger','allocate','restoreSongEdits','wishAdmin'])authorizeManagerOperation(streamer,{op:'mutate',action:{type}},'a');
 for(const op of ['backup','publish','migrate','setStreamerAccount','noticeSound'])assert.throws(()=>authorizeManagerOperation(streamer,{op},'a'));
 for(const type of ['player','self','streamer','cleanup'])assert.throws(()=>authorizeManagerOperation(streamer,{op:'mutate',action:{type}},'a'));
 assert.throws(()=>authorizeManagerOperation(streamer,{op:'read'},'b'));
 assert.throws(()=>authorizeManagerOperation(streamer,{op:'import',kind:'players'},'a'));
 assert.throws(()=>authorizeManagerOperation(player,{op:'read'},'a'));
});
test('global players remain visible while account secrets, notes and other rooms are removed',()=>{
 const view={currentStreamer:{id:'a'},streamers:[{id:'a'},{id:'b'}],players:[{playerId:'p',name:'玩家',ids:['1'],names:[],test:false,password:'secret',note:'private'}],migrationIssues:['other room'],streamerSettings:{b:{secret:true}},queue:[]};
 const out=managementView(view,streamer);assert.equal(out.players.length,1);assert.equal(out.players[0].name,'玩家');assert.equal(out.players[0].password,undefined);assert.equal(out.players[0].note,undefined);assert.equal(out.streamers.length,1);assert.equal(out.streamerSettings,undefined);assert.deepEqual(out.migrationIssues,[]);
 assert.equal(view.players[0].password,'secret');assert.equal(managementView(view,superAdmin),view);
});
test('players cannot replace audio; only management roles can',()=>{
 assert.equal(canReplaceSound(player),false);assert.equal(canReplaceSound(null),false);assert.equal(canReplaceSound(streamer),true);assert.equal(canReplaceSound(superAdmin),true);assert.equal(isSuper(streamer),false);
 assert.equal(validNoticeAudio('data:text/html;base64,YQ=='),false);assert.equal(validNoticeAudio('https://example.com/sound.mp3'),false);assert.equal(validNoticeAudio('data:audio/mp4;base64,YQ=='),true);assert.equal(validNoticeAudio('data:audio/mp4;base64,'+'A'.repeat(350000)),false);
});
test('legacy core receives manager role only after separate authorization',()=>{
 assert.equal(coreActor(superAdmin).role,'admin');assert.equal(coreActor(streamer).streamer_id,'a');assert.equal(coreActor(player),player);
});
