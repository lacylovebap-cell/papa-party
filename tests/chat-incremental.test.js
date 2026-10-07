import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {chatAccess,chatCursor,cleanChatMessage} from '../src/chat-policy.js';
import {createChat} from '../src/chat.js';

const row=seq=>({id:'m'+seq,seq,sender_side:'player',body:'message '+seq,created_at:'2026-10-01T00:00:00Z'});
function backend(){
 const paths=[];
 const context=vm.createContext({chatAccess,chatCursor,cleanChatMessage,scopeState:(s,id)=>({currentStreamer:s.streamers.find(r=>r.id===id)}),api:async path=>{
  paths.push(path);
  if(path.includes('papa_v2_entities'))return [{id:'P1',name:'Alice'}];
  if(path.includes('papa_chat_reads'))return [{reader:'streamer',last_seq:40},{reader:'super',last_seq:44},{reader:'player',last_seq:100}];
  if(path.includes('papa_chat_messages'))return Array.from({length:51},(_,i)=>row(path.includes('order=seq.asc')?i+21:80-i));
  throw Error('Unexpected request');
 }});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/party-api/chat.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'')),context);
 context.state={streamers:[{id:'papa',active:true,display_name:'怕怕'},{id:'michelle',active:true,display_name:'米雪'}]};
 context.who={role:'player',playerId:'P1'};
 return {paths,async request(body){context.body=body;return await vm.runInContext('chatOperation(body,who,state)',context);}};
}

test('chat after cursor returns earliest unseen page with bounded metadata and receipt updates',async()=>{
 const edge=backend(),result=await edge.request({op:'chatMessages',streamer:'papa',after:20});
 assert.equal(result.rows.length,50);assert.equal(result.rows[0].seq,21);assert.equal(result.rows.at(-1).seq,70);
 assert.equal(result.hasMore,true);assert.equal(result.recipientRead,44);
 assert.ok(edge.paths.some(p=>p.includes('streamer_id=eq.papa&player_id=eq.P1&seq=gt.20&select=id,seq,sender_side,body,created_at&order=seq.asc&limit=51')));
 assert.ok(edge.paths.some(p=>p.endsWith('papa_chat_reads?streamer_id=eq.papa&player_id=eq.P1&select=reader,last_seq')));
 await edge.request({op:'chatMessages',streamer:'papa',after:0});
 assert.ok(edge.paths.some(p=>p.includes('&seq=gt.0&')),'empty thread starts from zero rather than skipping a burst');
});

test('initial and older chat pages retain newest-first database pagination and chronological display',async()=>{
 const edge=backend();
 const initial=await edge.request({op:'chatMessages',streamer:'papa'});
 assert.equal(initial.rows[0].seq,31);assert.equal(initial.rows.at(-1).seq,80);
 const older=await edge.request({op:'chatMessages',streamer:'papa',before:31});
 assert.equal(older.rows.length,50);
 assert.ok(edge.paths.some(p=>p.includes('&seq=lt.31&')&&p.endsWith('&order=seq.desc&limit=51')));
 await assert.rejects(edge.request({op:'chatMessages',streamer:'papa',before:31,after:20}),/單一/);
 await assert.rejects(edge.request({op:'chatMessages',streamer:'papa',after:'1&x=y'}),/頁碼/);
 const previous=edge.paths.length;
 await assert.rejects(edge.request({op:'chatMessages',streamer:'papa',playerId:'P2',after:20}),/無法查看/);
 assert.equal(edge.paths.length,previous,'cross-player access is denied before even resolving names');
});

function frontend(api,realtimeAvailable=()=>false){
 const original={document:globalThis.document,setInterval:globalThis.setInterval};
 const events={},listeners={},timers=[],nodes={title:{textContent:''},error:{textContent:''},older:{hidden:true}};
 const box={innerHTML:'',scrollTop:0,clientHeight:100,get scrollHeight(){return (this.innerHTML.match(/data-chat-seq=/g)||[]).length*20;}};
 const dialog={open:false,_html:'',addEventListener(type,callback){events[type]=callback;},showModal(){this.open=true;},close(){this.open=false;events.close?.();},set innerHTML(value){this._html=value;box.innerHTML='';nodes.error.textContent='';},get innerHTML(){return this._html;},querySelector(selector){return ({'h2':nodes.title,'[data-chat-messages]':box,'[data-chat-error]':nodes.error,'[data-chat="older"]':nodes.older})[selector];}};
 const state={manager:false,playerId:'P1',streamer:'papa',streamerName:'怕怕',demo:false};
 globalThis.document={hidden:false,body:{append(){}},createElement(){return dialog;},addEventListener(type,callback){listeners[type]=callback;}};
 globalThis.setInterval=(callback,ms)=>{timers.push({callback,ms});return timers.length;};
 const calls=[],read=[];
 const chat=createChat({api:async b=>{calls.push({...b,room:state.streamer});return api(b);},context:()=>state,toast(){},onRead(){read.push(true);},realtimeAvailable});
 return {chat,state,dialog,box,nodes,calls,read,timers,listeners,seqs:()=>[...box.innerHTML.matchAll(/data-chat-seq="(\d+)"/g)].map(m=>Number(m[1])),async older(){await events.click({target:{closest:()=>({dataset:{chat:'older'}})}});},restore(){for(const [key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}};
}

function server(){
 const state={rows:[],receipt:0,failAfter:null};
 return {state,async api(b){
  if(b.op==='chatRead')return {ok:true};
  assert.equal(b.op,'chatMessages');
  if(b.after===state.failAfter)throw Error('Temporarily offline');
  const eligible=state.rows.filter(r=>b.before?r.seq<b.before:b.after!==undefined?r.seq>b.after:true);
  const chosen=b.after!==undefined?eligible.slice(0,50):eligible.slice(-50);
  return {rows:chosen,hasMore:eligible.length>50,recipientRead:state.receipt,playerName:'Alice',streamerName:'怕怕'};
 }};
}

test('chat appends all pages after a 120-message burst while preserving loaded older history',async()=>{
 const service=server();service.state.rows=Array.from({length:100},(_,i)=>row(i+101));
 const ui=frontend(service.api);
 try{
  await ui.chat.open();assert.deepEqual(ui.seqs(),Array.from({length:50},(_,i)=>151+i));assert.equal(ui.nodes.older.hidden,false);
  await ui.older();assert.deepEqual(ui.seqs(),Array.from({length:100},(_,i)=>101+i));assert.equal(ui.nodes.older.hidden,true);
  service.state.rows.push(...Array.from({length:120},(_,i)=>row(i+201)));
  await ui.chat.refresh();
  assert.deepEqual(ui.seqs(),Array.from({length:220},(_,i)=>101+i),'no gap or lost earlier page');
  assert.deepEqual(ui.calls.filter(c=>c.after!==undefined).map(c=>c.after),[200,250,300]);
  assert.equal(ui.calls.at(-1).through,320);assert.equal(ui.nodes.older.hidden,true,'delta hasMore must not change older-history availability');
  const before=ui.calls.length;await ui.chat.refresh();
  assert.equal(ui.calls.length,before+1,'idle poll does not resend read acknowledgement');assert.equal(ui.calls.at(-1).after,320);
  service.state.receipt=320;await ui.chat.refresh();
  assert.equal((ui.box.innerHTML.match(/<small>已讀<\/small>/g)||[]).length,220,'empty delta updates all sent-message receipts');
  assert.equal(ui.timers[0].ms,4000,'fallback latency is unchanged');
 }finally{ui.restore();}
});

test('empty chat uses after zero and resumes a failed catch-up without duplicates or skipped messages',async()=>{
 const service=server(),ui=frontend(service.api);
 try{
  await ui.chat.open();assert.deepEqual(ui.seqs(),[]);
  // Sequence numbers are global: gaps from other rooms are not missing messages.
  service.state.rows=Array.from({length:121},(_,i)=>row((i+1)*2));service.state.failAfter=100;
  await ui.chat.refresh();assert.equal(ui.seqs().length,50);assert.match(ui.nodes.error.textContent,/offline/);
  service.state.failAfter=null;await ui.chat.refresh();
  assert.deepEqual(ui.seqs(),Array.from({length:121},(_,i)=>(i+1)*2));
  assert.deepEqual(ui.calls.filter(c=>c.after!==undefined).map(c=>c.after),[0,100,100,200]);
  const before=ui.calls.length;document.hidden=true;await ui.chat.refresh();assert.equal(ui.calls.length,before,'hidden tab does not poll chat');
 }finally{ui.restore();}
});

test('overlapping refreshes are coalesced and a stale old-room response cannot replace a new thread',async()=>{
 let resolveOld;const old=new Promise(resolve=>resolveOld=resolve);let requests=0;
 const ui=frontend(async b=>{if(b.op==='chatRead')return {ok:true};requests++;if(requests===1)return old;return {rows:[row(999)],hasMore:false,recipientRead:0,streamerName:'米雪',playerName:'Alice'};});
 try{
  const opening=ui.chat.open();await ui.chat.refresh();assert.equal(requests,1,'same-generation in-flight read is reused');
  ui.state.streamer='michelle';ui.state.streamerName='米雪';ui.dialog.close();await ui.chat.open();
  assert.deepEqual(ui.seqs(),[999],'new context need not wait for old room request');
  resolveOld({rows:[row(100)],hasMore:false,recipientRead:100,streamerName:'怕怕',playerName:'Alice'});await opening;
  assert.deepEqual(ui.seqs(),[999]);assert.match(ui.nodes.title.textContent,/米雪/);
  await ui.chat.refresh();assert.equal(ui.calls.at(-1).after,999,'new thread owns its cursor');
 }finally{ui.restore();}
});

test('chat relies on new-message notices while Realtime is healthy and keeps the disconnected fallback',async()=>{
 const service=server(),connection={healthy:true},ui=frontend(service.api,()=>connection.healthy);
 try{
  await ui.chat.open();
  const baseline=ui.calls.length;
  ui.timers[0].callback();await new Promise(setImmediate);
  assert.equal(ui.calls.length,baseline,'healthy Realtime suppresses the four-second read');
  service.state.rows.push(row(1));
  await ui.chat.refresh();
  assert.deepEqual(ui.seqs(),[1],'notification-driven refresh still shows a message immediately');
  connection.healthy=false;
  const beforeFallback=ui.calls.length;
  ui.timers[0].callback();await new Promise(setImmediate);
  assert.equal(ui.calls.length,beforeFallback+1,'disconnected client resumes the original fallback');
 }finally{ui.restore();}
});
