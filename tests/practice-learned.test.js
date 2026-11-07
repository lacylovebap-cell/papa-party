import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,mutate} from '../src/core.js';
import {createPracticeZone} from '../src/practice-zone.js';
const admin={role:'admin'},t='2026-11-08T00:00:00Z';
test('practice items keep addedAt / learnedAt / published, and reject bad dates',()=>{
 const s=mutate(empty(),{type:'settings',data:{practiceZone:[
  {id:'a',title:'甲',artist:'乙',addedAt:'2026-11-01T01:00:00.000Z',learnedAt:'2026-11-05T02:00:00.000Z',published:true},
  {id:'b',title:'丙',artist:'丁',learnedAt:'not-a-date'}]}},admin,t);
 const z=s.settings.practiceZone;
 assert.equal(z[0].learnedAt,'2026-11-05T02:00:00.000Z');assert.equal(z[0].published,true);
 assert.equal(z[1].learnedAt,undefined);
});
test('stats: legacy learned without date is never counted into a month; toggling does not double count',()=>{
 let items=[{id:'1',title:'a',artist:'x',addedAt:new Date().toISOString()},{id:'2',title:'b',artist:'x',learned:true},{id:'3',title:'c',artist:'x',learnedAt:new Date().toISOString()}];
 const h=x=>String(x??'');const z=createPracticeZone({h,modal(){},field(){return ''},select(){return ''},area(){return ''},toast(){},render(){},getItems:()=>items,save:async l=>{items=l;}});
 const html=z.html();
 assert.match(html,/<b>1<\/b><small>🎵 目前待練/);assert.match(html,/<b>1<\/b><small>🌱 本月新增待練/);assert.match(html,/<b>1<\/b><small>🏆 本月已學會/);assert.match(html,/<b>2<\/b><small>⭐ 累計已學會/);
});
