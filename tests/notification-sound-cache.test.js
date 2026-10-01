import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotifications} from '../src/notifications.js';

test('player sound is downloaded only on version change and resets across identities',async()=>{
 const original={document:globalThis.document,window:globalThis.window,Audio:globalThis.Audio,localStorage:globalThis.localStorage,setInterval:globalThis.setInterval};
 const timers=[],sounds=[];
 const dialog={open:false,close(){this.open=false;},addEventListener(){}};
 globalThis.document={hidden:false,body:{append(){}},createElement(){return dialog;},querySelectorAll(){return [];},addEventListener(){}};
 globalThis.window={addEventListener(){}};
 globalThis.Audio=class{constructor(url){this.src=String(url);sounds.push(this);}pause(){}};
 globalThis.localStorage={getItem(){return null;},setItem(){}};
 globalThis.setInterval=(...args)=>{const id=original.setInterval(...args);timers.push(id);id.unref();return id;};
 let room='papa',recipient='P1',role='player',version='v1',audio='data:audio/mp4;base64,AAAA';
 const requests=[];
 try{
  const notices=createNotifications({
   api:async request=>{requests.push(request);return {rows:[],unread:{},preferences:{},playerSoundVersion:version,playerSound:request.soundVersion===version?null:audio};},
   context:()=>({demo:false,role,streamer:room,recipient,streamerName:room}),
   toast(){},onUpdate(){},apiUrl:'https://example.test/functions/v1/party-api',apiKey:'test'
  });
  await notices.refresh();
  assert.equal(requests.at(-1).soundVersion,'');
  assert.equal(sounds[0].src,audio);
  await notices.refresh();
  assert.equal(requests.at(-1).soundVersion,'v1');
  assert.equal(sounds[0].src,audio,'omitted audio must not erase the loaded sound');
  version='v2';audio='data:audio/mp4;base64,BBBB';
  await notices.refresh();
  assert.equal(requests.at(-1).soundVersion,'v1');
  assert.equal(sounds[0].src,audio,'new version updates the player sound');
  room='michelle';recipient='P2';
  await notices.refresh();
  assert.equal(requests.at(-1).soundVersion,'','identity switch cannot inherit the old cache key');
  assert.equal(sounds[0].src,audio);
  role='streamer_admin';recipient='__admin__';
  await notices.refresh();
  assert.equal(requests.at(-1).soundVersion,'');
  assert.match(sounds[0].src,/notification\.m4a$/,'manager uses its own local sound');
  version='default';audio=null;role='player';recipient='P3';
  await notices.refresh();
  assert.match(sounds[0].src,/notification\.m4a$/,'reset custom player sound restores the default');
 }finally{
  for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  for(const id of timers)clearInterval(id);
 }
});
