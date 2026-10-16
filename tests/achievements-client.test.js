import test from 'node:test';
import assert from 'node:assert/strict';
import {createAchievementPanel,achievementPanelHtml,achievementDetailsHtml,achievementHoldingState} from '../src/achievements-view.js';
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
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/取得時間尚無紀錄/);const detail=achievementDetailsHtml({name:'test',code:'sung50',qualified:true,visibility:'condition_hidden'});assert.match(detail,/取得時間尚無紀錄/);assert.match(detail,/取得條件暫不公開/);assert.doesNotMatch(html,/data-achievement-code/);
});

test('locked secrets cannot leak via atlas or detail; filters do not alter award rules',()=>{
 const rows=[{code:'chosen',name:'secret-name',condition:'secret-condition',visibility:'after_award',qualified:false},{code:'sung50',name:'50首兵郎',visibility:'public',qualified:true}];
 for(const html of [achievementPanelHtml(rows),achievementDetailsHtml(rows[0])]){assert.doesNotMatch(html,/secret-name|secret-condition/);assert.match(html,/？？？/);}
 const filtered=achievementPanelHtml(rows,{category:'performance',status:'earned'});assert.match(filtered,/50首兵郎/);assert.doesNotMatch(filtered,/？？？/);assert.match(filtered,/data-medal-detail="1"/);
});

test('only management catalog exposes policies; global and H/L remain locked',()=>{
 const rows=[{code:'sung50',name:'A',scope:'streamer',badgeId:'C01',emoji:'🌟',qualified:true},{code:'global',name:'G',scope:'global',badgeId:'P19',qualified:true},{code:'hidden',name:'H',scope:'streamer',badgeId:'H01',qualified:true},{code:'random',name:'L',scope:'streamer',badgeId:'L01',qualified:true}];
 for(const opts of [{publicControl:true},{manager:true}])assert.doesNotMatch(achievementPanelHtml(rows,opts),/data-achievement-code|data-medal-public-code/);
 const html=achievementPanelHtml(rows,{manager:true,managementCatalog:true});
 assert.equal((html.match(/data-achievement-code=/g)||[]).length,1);assert.match(html,/data-achievement-code="sung50"/);
 assert.doesNotMatch(achievementDetailsHtml({...rows[2],visibility:'condition_hidden',condition:'SECRET'}),/SECRET/);
 assert.match(achievementDetailsHtml({...rows[2],visibility:'condition_hidden',condition:'SECRET'},{manager:true}),/SECRET/);
});

test('permanent inactive awards never say expired; revoked history is retained but not counted as earned',()=>{
 const row={code:'after_failure',name:'這次有我',lifetime:'permanent',qualified:false,recorded:true,currentActive:false,expiresAt:null,visibility:'public'};
 assert.equal(achievementHoldingState(row),'判定未生效（非到期）');assert.doesNotMatch(achievementDetailsHtml(row),/已到期|已過期/);
 assert.equal(achievementHoldingState({...row,lifetime:'7d',expiresAt:'2020-01-01'}),'已到期');assert.equal(achievementHoldingState({...row,lifetime:'holding'}),'目前未符合持有條件');
 const revoked={...row,revoked:true,revocationReason:'來源核對不符合'};assert.equal(achievementHoldingState(revoked),'已摘除');
 const html=achievementPanelHtml([revoked]);assert.match(html,/已解鎖 0 \/ 1/);assert.match(html,/已摘除/);assert.match(html,/medal-locked/);assert.doesNotMatch(achievementPanelHtml([revoked],{status:'earned'}),/data-medal-detail=/);
 assert.match(achievementDetailsHtml(revoked),/來源核對不符合/);
});
