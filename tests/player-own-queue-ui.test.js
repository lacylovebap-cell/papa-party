import {songSelection} from '../src/core.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createOwnQueue,ownQueueCancelJobs} from '../src/player-own-queue.js';
const lines=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').split(/\r?\n/);
function take(name){const start=lines.findIndex(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('));assert.ok(start>=0,name);if(lines[start].endsWith('}'))return lines[start];const end=lines.findIndex((line,i)=>i>start&&line==='}');return lines.slice(start,end+1).join('\n');}
function fixture(){
 let current,callback=async b=>({results:b.jobs.map(j=>({streamer:j.streamer,ok:true,count:j.rows.length,revision:6}))}),reads=0,closed=0;
 const calls=[],toasts=[],nodes=new Map(),row={id:'q1',streamerId:'r1',slug:'r1',name:'Room',title:'Original',artist:'Singer',kind:'saved',status:'waiting',active:true};
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;closed++;},set innerHTML(html){const error={textContent:''},submit={disabled:false};current={fields:new Map(),querySelector:s=>s==='[type=submit]'?submit:null,error};nodes.clear();for(const id of ['own-replace-query','own-replace-results','own-replace-chosen','own-replace-quote'])nodes.set('#'+id,{value:'Song',innerHTML:'',addEventListener(){}});}};
 class FormData{constructor(form){this.form=form;}has(k){return this.form.fields.has(k);}}
 const ownQueue=createOwnQueue({identity:()=> 'scope',read:async()=>({rows:[row],total:1,revision:5})});
 const ctx=vm.createContext({songSelection,ownQueue,ownQueueCancelJobs,FormData,session:{accountId:'a1',playerId:'p1'},state:{revision:5,currentStreamer:{id:'r1',spaceId:'space-001'}},demo:false,draft:null,isAdmin:()=>false,
  h:x=>String(x??''),button:(x,a)=>'<button data-act="'+a+'">'+x+'</button>',check:()=>'',blank:x=>x,toast:x=>toasts.push(x),refresh:async()=>{},loadOwnQueue:async()=>{reads++;},
  $:s=>s==='#dialog'?dialog:s==='#modal-form'?current:s==='#dialog-error'?current.error:nodes.get(s),
  api:async b=>{calls.push(structuredClone(b));return callback(b);}
 });vm.runInContext('let ownReplacement=null;'+['modal','crossIdentity','ownQueueIdentity','sendOwnQueueBatch','cancelOwnQueue','openOwnReplacement','ownReplacementActive','searchOwnReplacement','chooseOwnReplacement','quoteOwnReplacement'].map(take).join('\n'),ctx);
 const run=code=>vm.runInContext(code,ctx);return {ctx,ownQueue,row,calls,toasts,nodes,run,dialog,setResponse:fn=>callback=fn,get form(){return current;},get closed(){return closed;},get reads(){return reads;},async cancel(){await ownQueue.load();ctx.rows=[row];await run('cancelOwnQueue(rows)');return current;},submit(form=current){return form.onsubmit({preventDefault(){},currentTarget:form});}};
}
test('cancel review latches uncertain dispatch and refuses retries or another-account submission',async()=>{
 const f=fixture();f.setResponse(async()=>{throw Error('Network interrupted');});const form=await f.cancel();await f.submit(form);assert.match(form.error.textContent,/結果未確認.*勿重複/);await f.submit(form);assert.equal(f.calls.length,1);assert.equal(f.closed,0);
 const other=fixture(),second=await other.cancel();other.ctx.session.accountId='other';await other.submit(second);assert.equal(other.calls.length,0);assert.match(second.error.textContent,/登入或主播已變更/);
});
test('late cancellation completion cannot close a newly opened modal or mutate its selection',async()=>{
 let resolve;const f=fixture();f.setResponse(()=>new Promise(yes=>resolve=yes));const old=await f.cancel(),pending=f.submit(old);const next=await f.cancel();resolve({results:[{streamer:'r1',ok:true,count:1,revision:6}]});await pending;assert.equal(f.closed,0);assert.equal(f.form,next);assert.equal(f.reads,0);assert.equal(f.toasts.length,0);
});
test('replacement requires a verified quote and current modal identity before its single dispatch',async()=>{
 const f=fixture();await f.ownQueue.load();await f.run("openOwnReplacement('q1')");await f.submit();assert.equal(f.calls.length,0);assert.match(f.form.error.textContent,/選歌/);
 f.run("ownReplacement.chosen={songId:'s2',title:'Replacement',artist:'Singer',pairOptions:[]};ownReplacement.quote={kind:'saved',creditCost:1};ownReplacement.revision=5;");await f.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].jobs[0].rows[0].operation,'replace');assert.equal(f.closed,1);
 const live=fixture();live.row.kind='live';await live.ownQueue.load();await live.run("openOwnReplacement('q1');ownReplacement.chosen={songId:'s2',title:'Replacement',artist:'Singer',pairOptions:[]};ownReplacement.quote={kind:'live',creditCost:1};ownReplacement.revision=5;");await live.submit();assert.equal(live.calls.length,1,'no separate gift checkbox: submitting the dialog is the confirmation');assert.equal(live.calls[0].jobs[0].rows[0].giftConfirmed,true);
});
test('quote refresh clears old approval and ignores old responses after reopening',async()=>{
 let resolve;const f=fixture();await f.ownQueue.load();await f.run("openOwnReplacement('q1');ownReplacement.chosen={songId:'s2',title:'Replacement',artist:'Singer',pairOptions:[]};ownReplacement.quote={kind:'saved',creditCost:1};");f.setResponse(()=>new Promise(yes=>resolve=yes));const pending=f.run('quoteOwnReplacement()');assert.equal(f.run('ownReplacement.quote'),null);
 await f.run("openOwnReplacement('q1')");resolve({revision:5,quote:{songId:'s2',kind:'saved',creditCost:1,price:2990,double:500}});await pending;assert.equal(f.run('ownReplacement.quote'),null);
});
