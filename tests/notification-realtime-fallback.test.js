import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

test('connected notification Realtime suppresses duplicate polling, with disconnected fallback',async()=>{
 const saved={document:globalThis.document,window:globalThis.window,Audio:globalThis.Audio,
  localStorage:globalThis.localStorage,WebSocket:globalThis.WebSocket,setInterval:globalThis.setInterval,
  dateNow:Date.now};
 const timers=[];let socket,reads=0;
 const dialog={open:false,close(){},addEventListener(){}};
 try{
  globalThis.document={hidden:false,body:{append(){}},createElement(){return dialog;},
   querySelectorAll(){return [];},addEventListener(){}};
  globalThis.window={addEventListener(){}};
  globalThis.Audio=class{constructor(url){this.src=String(url);}pause(){}};
  globalThis.localStorage={getItem(){return null;},setItem(){}};
  globalThis.WebSocket=class{constructor(){socket=this;this.readyState=0;}send(){}close(){this.readyState=3;}};
  globalThis.setInterval=(callback,ms)=>{timers.push({callback,ms});return timers.length;};
  const notifications=createNotifications({
   api:async()=>{reads++;return {rows:[],unread:{},preferences:{},topic:'scoped-topic'};},
   context:()=>({demo:false,role:'player',streamer:'papa',recipient:'P1',streamerName:'怕怕'}),
   toast(){},apiUrl:'https://example.test/functions/v1/party-api',apiKey:'test'
  });
  await notifications.refresh();
  assert.equal(reads,1);
  socket.readyState=1;socket.onopen();await new Promise(setImmediate);
  const fallback=timers.find(timer=>timer.ms===30000);
  assert.ok(fallback);
  const connectedReads=reads;
  fallback.callback();await new Promise(setImmediate);
  assert.equal(reads,connectedReads,'connected Realtime does not duplicate the request');
  socket.onmessage({data:JSON.stringify({event:'broadcast'})});await new Promise(setImmediate);
  assert.equal(reads,connectedReads+1,'a broadcast still refreshes immediately');
  Date.now=()=>saved.dateNow()+61000;
  fallback.callback();await new Promise(setImmediate);
  assert.equal(socket.readyState,3,'a stale but open socket is closed');
  assert.equal(reads,connectedReads+2,'a stale socket uses the fallback');
  Date.now=saved.dateNow;
  fallback.callback();await new Promise(setImmediate);
  assert.equal(reads,connectedReads+3,'disconnected socket keeps using the fallback');
 }finally{
  for(const [key,value] of Object.entries(saved)){
   if(key==='dateNow'){Date.now=value;continue;}
   if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
 }
});
