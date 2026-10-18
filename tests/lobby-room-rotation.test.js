import test from 'node:test';
import assert from 'node:assert/strict';
import {createLobbyRoomRotation} from '../src/lobby-room-rotation.js';
test('rotation has one timer, pauses for combined interactions and does not overlap asynchronous pages',async()=>{
 const timers=new Map();let serial=0,moves=0,resolve;
 const view={total:6,pageSize:3,loading:false,error:''};
 const rotation=createLobbyRoomRotation({snapshot:()=>view,advance:()=>{moves++;return new Promise(r=>resolve=r);},setTimer:fn=>{timers.set(++serial,fn);return serial;},clearTimer:id=>timers.delete(id)});
 rotation.sync();rotation.sync();assert.equal(timers.size,1);
 rotation.pause('hover');rotation.pause('focus');assert.equal(timers.size,0);
 rotation.pause('hover',false);assert.equal(timers.size,0);rotation.pause('focus',false);assert.equal(timers.size,1);
 const [id,fn]=[...timers][0];timers.delete(id);const running=fn();rotation.sync();assert.equal(moves,1);assert.equal(timers.size,0);
 rotation.pause('hidden');resolve();await running;assert.equal(timers.size,0);rotation.pause('hidden',false);assert.equal(timers.size,1);
 view.total=3;rotation.sync();assert.equal(timers.size,0);view.total=6;view.error='offline';rotation.sync();assert.equal(timers.size,0);
 view.error='';rotation.sync();rotation.stop();assert.equal(timers.size,0);
});
