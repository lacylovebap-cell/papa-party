import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const lines=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').split(/\r?\n/);
function declaration(name){
 const start=lines.findIndex(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('));
 assert.ok(start>=0,name);
 if(lines[start].endsWith('}'))return lines[start];
 const end=lines.findIndex((line,index)=>index>start&&line==='}');
 assert.ok(end>start,name+' closes');return lines.slice(start,end+1).join('\n');
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const event=form=>({preventDefault(){},currentTarget:form});
const room=id=>({streamerId:id,slug:id+'-slug',name:id,status:'idle',storedCredits:10,waitingCount:0});

function ui(){
 let current=null,closed=0,refreshes=0,writeResponse=async body=>({results:body.jobs.map(job=>({streamer:job.streamer,ok:true,count:job.rows.length}))});
 const calls=[],toasts=[],rowNodes=new Map();
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;closed++;},set innerHTML(value){
  const submit={disabled:false},error={textContent:'',insertAdjacentHTML(){}},results={innerHTML:''},controls=[submit,{disabled:false}];
  const form={fields:new Map(),submit,error,results,controls,querySelector(selector){return selector==='[type=submit]'?submit:selector==='#cross-error'?error:selector.startsWith('[data-cross-pair=')?{value:''}:null;},querySelectorAll(){return controls;}};
  current={form,error,results,modal:value.includes('id="modal-form"'),cross:value.includes('id="cross-request-form"')};
  rowNodes.clear();
  for(const id of crossView.drafts.keys()){
   const fields=new Map(['data-cross-query','data-cross-tags','data-cross-song','data-cross-results','data-cross-self'].map(key=>[key,{value:'愛',innerHTML:'',checked:false}]));
   rowNodes.set(id,{dataset:{crossRow:id},querySelector:selector=>fields.get(selector.slice(1,-1)),querySelectorAll:()=>[]});
  }
 }};
 class FormData{constructor(form){this.form=form;}has(key){return this.form.fields.has(key);}get(key){return this.form.fields.get(key);}}
 const crossView={selected:new Map(),drafts:new Map(),submitted:false,rows:[],page:0,total:0,generation:0,key:'',loading:false,error:''};
 const selectedFavorites=new Set(['s1']),selectedFavoriteRows=new Map([['s1',{songId:'s1',title:'收藏歌',artist:'演唱者',creditCost:1}]]);
 const ctx=vm.createContext({FormData,dialog,crossView,selectedFavorites,selectedFavoriteRows,session:{accountId:'a1',playerId:'p1'},state:{revision:5,currentStreamer:{id:'r1',spaceId:'space-001'}},streamerSlug:'papa',demo:false,draft:null,
  h:value=>String(value??''),button:(label,act)=>'<button data-act="'+act+'">'+label+'</button>',check:()=>'',blank:value=>value,song:()=>null,toast:value=>toasts.push(value),refresh:async()=>{refreshes++;},
  $:selector=>selector==='#dialog'?dialog:selector==='#modal-form'&&current?.modal?current.form:selector==='#cross-request-form'&&current?.cross?current.form:selector==='#dialog-error'?current?.error:selector==='#cross-results'?current?.results:null,
  document:{querySelectorAll:()=>[...rowNodes.values()]},
  api:async body=>{calls.push(structuredClone(body));if(body.op==='requestsBatch')return writeResponse(body);if(body.op==='playerStreamerSummary')return {rows:[],total:0};return {rows:[{songId:body.streamer+'-song',title:'可點歌曲',artist:'演唱者',tags:[],creditCost:1}],total:1,tagOptions:[]};},
 });
 vm.runInContext("let favoriteSelectionIdentity=JSON.stringify(['a1','p1','space-001','r1']); const crossStatusName={idle:'空閒中',preparing:'準備中',busy:'忙碌中',paused:'暫停点歌'};",ctx);
 vm.runInContext(['modal','favoritesIdentity','requestSelectedFavorites','favoritePairOptions','crossIdentity','crossSummaryHtml','centerWaitingHtml','renderCrossStreamers','loadCrossSummary','openCrossRequest','crossRowElement','resetConfirmedCrossBatch','renderCrossSong','loadCrossSongs','chooseCrossSong','crossPairOptions'].map(declaration).join('\n'),ctx);
 const run=code=>vm.runInContext(code,ctx);
 return {ctx,dialog,crossView,calls,toasts,selectedFavorites,selectedFavoriteRows,run,setWrite:fn=>writeResponse=fn,get current(){return current;},get closed(){return closed;},get refreshes(){return refreshes;},async favorite(kind='saved'){await run("requestSelectedFavorites('"+kind+"')");return current.form;},async cross(id='a'){crossView.selected.clear();crossView.selected.set(id,room(id));await run("openCrossRequest('saved')");run("chooseCrossSong('"+id+"','"+id+"-slug-song')");return current.form;}};
}

test('favorite batch latches before dispatch and cannot retry an uncertain commit in the same form',async()=>{
 const u=ui(),write=deferred();u.setWrite(()=>write.promise);const form=await u.favorite(),pending=form.onsubmit(event(form));
 assert.equal(u.calls.filter(body=>body.op==='requestsBatch').length,1);
 await form.onsubmit(event(form));assert.equal(form.submit.disabled,true);assert.equal(u.calls.filter(body=>body.op==='requestsBatch').length,1);
 write.reject(Error('Network interrupted'));await pending;
 assert.match(form.error.textContent,/結果不明.*勿重複送出.*關閉並重新開啟/);assert.equal(u.closed,0);assert.equal(u.refreshes,0);
 await form.onsubmit(event(form));assert.equal(u.calls.filter(body=>body.op==='requestsBatch').length,1);
});

test('favorite live gift validation occurs before the latch and permits the corrected first dispatch',async()=>{
 const u=ui(),form=await u.favorite('live');await form.onsubmit(event(form));assert.match(form.error.textContent,/禮物/);assert.equal(u.calls.length,0);
 form.fields.set('gift','on');await form.onsubmit(event(form));assert.equal(u.calls.filter(body=>body.op==='requestsBatch').length,1);assert.equal(u.closed,1);assert.equal(u.refreshes,1);
});

test('favorite success or error arriving after same-identity reopen cannot close or alter the new modal',async()=>{
 for(const success of [true,false]){
  const u=ui(),write=deferred();u.setWrite(()=>write.promise);const old=await u.favorite(),pending=old.onsubmit(event(old));u.dialog.close();
  const replacement=await u.favorite();replacement.error.textContent='new dialog';
  if(success)write.resolve({results:[{streamer:'papa',ok:true,count:1}]});else write.reject(Error('late old error'));
  await pending;assert.equal(u.dialog.open,true);assert.equal(u.closed,1);assert.equal(replacement.error.textContent,'new dialog');assert.equal(u.refreshes,0);assert.deepEqual([...u.selectedFavorites],['s1']);assert.equal(u.toasts.length,0);
 }
});

test('generic modal ignores late success and error from a replaced captured form',async()=>{
 for(const success of [true,false]){
  const u=ui(),wait=deferred();u.ctx.submit=()=>wait.promise;u.run("modal('old','',submit)");const old=u.current.form,pending=old.onsubmit(event(old));
  u.run("modal('new','',async()=>{})");const replacement=u.current;replacement.error.textContent='new';
  if(success)wait.resolve();else wait.reject(Object.assign(Error('old'),{liveSongId:'s1'}));
  await pending;assert.equal(u.closed,0);assert.equal(u.dialog.open,true);assert.equal(replacement.error.textContent,'new');
 }
});

test('cross receipts and errors cannot alter a reopened modal under the same player and Space',async()=>{
 for(const success of [true,false]){
  const u=ui(),write=deferred();u.setWrite(()=>write.promise);const old=await u.cross('a'),pending=old.onsubmit(event(old));u.dialog.close();
  const replacement=await u.cross('b');replacement.error.textContent='new dialog';replacement.results.innerHTML='new results';
  if(success)write.resolve({results:[{streamer:'a-slug',ok:true,count:1}]});else write.reject(Error('old result unknown'));
  await pending;assert.equal(u.dialog.open,true);assert.equal(replacement.error.textContent,'new dialog');assert.equal(replacement.results.innerHTML,'new results');assert.equal(u.refreshes,0);assert.equal(u.crossView.submitted,false);
 }
});

test('a cross receipt after close performs no result render or follow-up state refresh',async()=>{
 const u=ui(),write=deferred();u.setWrite(()=>write.promise);const form=await u.cross(),pending=form.onsubmit(event(form));u.dialog.close();
 write.resolve({results:[{streamer:'a-slug',ok:true,count:1}]});await pending;assert.equal(form.results.innerHTML,'');assert.equal(u.refreshes,0);assert.equal(u.calls.filter(body=>body.op==='requestsBatch').length,1);
});

test('unknown per-room receipts show pending confirmation and preserve the no-retry latch',async()=>{
 for(const favorite of [true,false]){
  const u=ui();u.setWrite(async body=>({results:body.jobs.map(job=>({streamer:job.streamer,ok:false,unknown:true,error:'Database transport failure'}))}));
  const form=favorite?await u.favorite():await u.cross();await form.onsubmit(event(form));
  assert.match(favorite?form.error.textContent:form.results.innerHTML,/結果待確認.*待播.*避免重複/);
  await form.onsubmit(event(form));assert.equal(u.calls.filter(body=>body.op==='requestsBatch').length,1);
 }
});

test('a confirmed cross batch can start a fresh choice in the same modal without replaying its successful songs',async()=>{
 const u=ui(),form=await u.cross();await form.onsubmit(event(form));
 assert.equal(u.closed,0);assert.equal(u.crossView.submitted,false);assert.equal(u.crossView.drafts.get('a').chosen,null);assert.equal(form.submit.disabled,false);
 await form.onsubmit(event(form));assert.equal(u.calls.filter(body=>body.op==='requestsBatch').length,1,'empty success selections cannot resend');
 await u.run("loadCrossSongs('a',false,0)");u.run("chooseCrossSong('a','a-slug-song')");await form.onsubmit(event(form));
 assert.equal(u.calls.filter(body=>body.op==='requestsBatch').length,2);assert.equal(u.crossView.drafts.get('a').chosen,null);assert.equal(u.dialog.open,true);
});

test('cross dice provenance survives the submitted row and explicit manual selection clears that provenance',async()=>{
 const u=ui(),form=await u.cross();await u.run("loadCrossSongs('a',true,0)");await form.onsubmit(event(form));
 const job=u.calls.find(body=>body.op==='requestsBatch').jobs[0];assert.equal(job.rows[0].selfProvided,true);assert.equal(job.rows[0].source,'cross_draw');
 await u.run("loadCrossSongs('a',true,0,'cross_self')");assert.equal(u.crossView.drafts.get('a').source,'cross_self');
 await u.run("loadCrossSongs('a',false,0)");u.run("chooseCrossSong('a','a-slug-song')");assert.equal(u.crossView.drafts.get('a').source,'manual');assert.equal(u.crossView.drafts.get('a').selfProvided,false);
});
