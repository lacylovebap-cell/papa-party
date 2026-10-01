import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

test('old unread notices do not repeatedly reload related views, while new notices still do',async()=>{
 const original={document:globalThis.document,window:globalThis.window,Audio:globalThis.Audio,localStorage:globalThis.localStorage,setInterval:globalThis.setInterval};
 const timers=[];
 const dialog={open:false,close(){this.open=false;},addEventListener(){}};
 globalThis.document={hidden:false,body:{append(){}},createElement(){return dialog;},querySelectorAll(){return [];},addEventListener(){}};
 globalThis.window={addEventListener(){}};
 globalThis.Audio=class{constructor(url){this.src=String(url);}pause(){}};
 globalThis.localStorage={getItem(){return null;},setItem(){}};
 globalThis.setInterval=(...args)=>{const id=original.setInterval(...args);timers.push(id);id.unref();return id;};
 let room='papa',rows=[],relatedRefreshes=0,apiCalls=0;
 const notice=(id,read_at=null)=>({id,type:'message',body:'新私訊',read_at,created_at:new Date().toISOString()});
 try{
  const notifications=createNotifications({
   api:async({op})=>{assert.equal(op,'notifications');apiCalls++;return {rows,unread:{message:rows.filter(n=>!n.read_at).length},preferences:{muteAll:true}};},
   context:()=>({demo:false,role:'super_admin',streamer:room,recipient:'__super__',streamerName:room}),
   toast(){},onUpdate(){relatedRefreshes++;},apiUrl:'https://example.test/functions/v1/party-api',apiKey:'test'
  });

  rows=[notice('old')];
  await notifications.refresh();
  await notifications.refresh();
  await notifications.refresh();
  assert.equal(apiCalls,3,'the notification fallback poll still runs');
  assert.equal(relatedRefreshes,0,'an existing unread notice must not trigger another full app/chat read');

  rows=[notice('new'),notice('old')];
  await notifications.refresh();
  assert.equal(relatedRefreshes,1,'a new unread notice triggers one related-view refresh');
  await notifications.refresh();
  assert.equal(relatedRefreshes,1,'polling the same new notice cannot repeat the refresh');

  rows=[notice('already-read',new Date().toISOString()),...rows];
  await notifications.refresh();
  assert.equal(relatedRefreshes,1,'newly seen but already-read notices do not refresh related views');

  room='michelle';rows=[notice('another-room-old')];
  await notifications.refresh();
  assert.equal(relatedRefreshes,1,'first load after a room switch is priming, not a new event');
  rows=[notice('another-room-new'),...rows];
  await notifications.refresh();
  assert.equal(relatedRefreshes,2,'a genuinely new notice in the new room still refreshes');
 }finally{
  for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  for(const id of timers)clearInterval(id);
 }
});
