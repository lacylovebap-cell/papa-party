import test from 'node:test';
import assert from 'node:assert/strict';
import {createAchievementPanel,achievementPanelHtml} from '../src/achievements-view.js';
const context=()=>({active:true,key:'player:P1:room',revision:1,manager:false,playerId:'P1',spaceId:'space-001',room:'papa'});
const response=c=>({version:1,scope:{spaceId:c.spaceId,streamerId:c.room,playerId:c.playerId},rows:[{code:'sung50',name:'50首兵郎',qualified:true,condition:'50',acquiredAt:null}]});
test('one bounded demand read is shared and cached; actor/Space changes discard old responses',async()=>{
 let c=context(),resolve;const calls=[],renders=[];
 const panel=createAchievementPanel({context:()=>c,render:x=>renders.push(x),api:b=>{calls.push(b);return new Promise(r=>resolve=r);}});
 const p=panel.load();panel.load();assert.equal(calls.length,1);resolve(response(c));await p;await panel.load();assert.equal(calls.length,1);
 c={...c,revision:2};const old=panel.load();const oldContext=c;c={...c,key:'player:P2:other',playerId:'P2',room:'other'};resolve(response(oldContext));await old;
 assert.equal(renders.filter(x=>x.rows).length,2);
});
test('read scope mismatch fails closed and readonly player cannot set visibility',async()=>{
 const renders=[],panel=createAchievementPanel({context,render:x=>renders.push(x),api:async()=>({...response(context()),scope:{spaceId:'foreign',streamerId:'papa',playerId:'P1'}})});
 await panel.load();assert.match(renders.at(-1).error,/未確認/);await assert.rejects(panel.visibility('sung50','public'),/管理/);
});
test('display escapes stored labels, shows unknown historical acquisition time and never exposes hidden condition data',()=>{
 const html=achievementPanelHtml([{name:'<img src=x onerror=alert(1)>',code:'sung50',qualified:true,condition:null,acquiredAt:null,lifetime:'permanent',visibility:'condition_hidden'}]);
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/取得时间|取得時間尚無紀錄/);assert.match(html,/取得條件暫不公開/);assert.doesNotMatch(html,/data-achievement-code/);
});
