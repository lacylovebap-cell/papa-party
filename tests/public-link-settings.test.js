import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicLinkSettings} from '../src/public-link-settings.js';
import {createPublicLinkClient} from '../src/public-links.js';

const owner={actorKey:'session-A',role:'streamer_admin',spaceId:'space-001',streamerId:'papa',name:'怕怕',spaceName:'聲瑪'};
const row=(extra={})=>({version:1,kind:'streamer',spaceId:'space-001',streamerId:'papa',streamerSlug:'papa',revision:3,configured:true,canonicalPath:'/pa',code:'pa',spaceCode:'sm',layout:'flat',...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

function fixture({identity=owner,api:handler=async body=>row(),onSaved=()=>{},copy=async()=>{}}={}){
 let actor={...identity},form;const calls=[],modals=[],toasts=[],shared=[],saved=[],copies=[];
 const dialog={open:true};
 const document={querySelector:s=>s==='#dialog'?dialog:s==='[data-public-link-form]'?form:null,execCommand:()=>true};
 const manager=createPublicLinkSettings({api:async body=>{calls.push(body);return handler(body);},context:()=>actor,onSaved:async value=>{saved.push(value);await onSaved(value);},
  toast:text=>toasts.push(text),share:{open:async value=>shared.push(value)},document,navigator:{clipboard:{writeText:async text=>{copies.push(text);return copy(text);}}},
  modal:(title,body)=>{
   modals.push({title,body});if(form)form.isConnected=false;
   const nodes=new Map(),url=/data-public-current readonly value="([^"]*)"/.exec(body)?.[1]||'',code=/name="code" value="([^"]*)"/.exec(body)?.[1]||'';
   const add=(key,value='')=>{const node={value,disabled:false,readOnly:false,textContent:'',focus(){this.focused=true;},select(){this.selected=true;}};nodes.set(key,node);return node;};
   add('[data-public-current]',url);add('[data-public-scope]');add('[name=code]',code);
   if(body.includes('name="layout"'))add('[name=layout]',body.includes('value="independent" selected')?'independent':'hall');
   for(const selector of ['[data-public-check]','[type=submit]','[data-public-copy]','[data-public-preview]','[data-public-reload]'])add(selector).disabled=['[data-public-copy]','[data-public-preview]'].includes(selector)&&!url;
   add('[data-public-error]');add('[data-public-status]');
   form={isConnected:true,nodes,querySelector:s=>nodes.get(s)||null,querySelectorAll:s=>s==='button'?[...nodes.entries()].filter(([key])=>key.startsWith('[data-public-')&&!['[data-public-current]','[data-public-scope]','[data-public-error]','[data-public-status]'].includes(key)||key==='[type=submit]').map(([,node])=>node):[],reportValidity(){return nodes.get('[name=code]').disabled||/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/.test(nodes.get('[name=code]').value);}};
  }});
 return {manager,calls,modals,toasts,shared,saved,copies,dialog,get form(){return form;},node:s=>form.querySelector(s),setActor:next=>{actor={...next};},submit(){let prevented=false;form.onsubmit({preventDefault(){prevented=true;}});assert.equal(prevented,true);return settle();}};
}

test('settings is lazy and scoped to the own streamer; player/foreign override cannot start a request',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);await f.manager.open();assert.deepEqual(f.calls,[{op:'publicRouteSettings',kind:'streamer',spaceId:'space-001',streamerId:'papa',management:true}]);
 assert.equal(f.node('[data-public-current]').value,'https://paparty.app/pa');assert.equal(f.node('[name=layout]'),null);
 await assert.rejects(f.manager.open({streamerId:'mimi'}),/自己/);assert.equal(f.calls.length,1);
 const player=fixture({identity:{...owner,role:'player'}});await assert.rejects(player.manager.open(),/主播或總裁/);assert.equal(player.calls.length,0);
});

test('a president can manage a hall without an active streamer and can target another streamer',async()=>{
 const hall=fixture({identity:{role:'super_admin',actorKey:'president'},api:async()=>row({kind:'hall',spaceId:'space-Q',streamerId:null,streamerSlug:null,code:'qq',spaceCode:'qq',canonicalPath:'/qq',layout:'hall'})});
 await hall.manager.open({kind:'hall',spaceId:'space-Q'});assert.equal(hall.calls[0].streamerId,null);assert.equal(hall.node('[name=layout]').value,'hall');
 const other=fixture({identity:{...owner,role:'super_admin'},api:async()=>row({streamerId:'mimi',streamerSlug:'michelle',canonicalPath:'/MICHELLE',code:'MICHELLE'})});
 await other.manager.open({streamerId:'mimi'});await other.node('[data-public-preview]').onclick();assert.equal(other.shared[0].url,'https://paparty.app/MICHELLE');assert.notEqual(other.shared[0].name,'怕怕');assert.equal(other.calls.length,1,'opening QR reuses already-read metadata');
});

test('a changed identity or scope during initial read cannot open a stale management dialog',async()=>{
 const pending=deferred(),f=fixture({api:()=>pending.promise}),opening=f.manager.open();
 f.setActor({...owner,actorKey:'session-B'});pending.resolve(row());await opening;assert.equal(f.modals.length,0);
 const g=fixture({api:()=>Promise.resolve(row({spaceId:'space-other'}))});await assert.rejects(g.manager.open(),/範圍/);assert.equal(g.modals.length,0);
});

test('check is on demand and shows exact proposed URL or historical-alias conflict without changing the current link',async()=>{
 let conflict=false;const f=fixture({api:async body=>body.op==='publicRouteCheck'?row({available:!conflict,reason:conflict?'reserved_history_or_in_use':null,proposedPath:'/PAPA520'}):row()});
 await f.manager.open();f.node('[name=code]').value='PAPA520';f.form.oninput();await f.node('[data-public-check]').onclick();
 assert.match(f.node('[data-public-status]').textContent,/https:\/\/paparty.app\/PAPA520/);assert.equal(f.node('[data-public-current]').value,'https://paparty.app/pa');
 assert.deepEqual(f.calls[1],{op:'publicRouteCheck',kind:'streamer',spaceId:'space-001',streamerId:'papa',code:'PAPA520',management:true});
 conflict=true;await f.node('[data-public-check]').onclick();assert.match(f.node('[data-public-status]').textContent,/保留給原來/);
 assert.equal(f.saved.length,0);assert.equal(f.calls.length,3);
});

test('save sends one CAS mutation and stays locked throughout asynchronous post-save synchronization',async()=>{
 const mutation=deferred(),synced=deferred();
 const f=fixture({api:body=>body.op==='publicRouteSave'?mutation.promise:row(),onSaved:()=>synced.promise});
 await f.manager.open();f.node('[name=code]').value='PAPA520';await f.submit();await f.submit();assert.equal(f.calls.length,2);assert.equal(f.node('[name=code]').disabled,true);
 assert.deepEqual(f.calls[1],{op:'publicRouteSave',kind:'streamer',spaceId:'space-001',streamerId:'papa',code:'PAPA520',management:true,revision:3});
 mutation.resolve(row({canonicalPath:'/PAPA520',code:'PAPA520',revision:4,changed:true}));await settle();
 assert.equal(f.saved.length,1);assert.equal(f.node('[name=code]').disabled,true,'field refresh must not unlock while synchronization is pending');await f.submit();assert.equal(f.calls.length,2);
 synced.resolve();await settle();assert.equal(f.node('[name=code]').disabled,false);assert.equal(f.node('[data-public-current]').value,'https://paparty.app/PAPA520');assert.match(f.node('[data-public-status]').textContent,/已儲存/);
 await f.node('[data-public-copy]').onclick();assert.deepEqual(f.copies,['https://paparty.app/PAPA520']);assert.equal(f.calls.length,2);
});

test('errors unlock without fabricating a save, retain CAS until reload, and reject invalid check data',async()=>{
 let badCheck=false,latest=false;const f=fixture({api:async body=>{if(body.op==='publicRouteSave')throw Error('PUBLIC_ROUTE_REVISION_CHANGED');if(body.op==='publicRouteCheck'){if(badCheck)return row({available:true,proposedPath:'//evil.test'});throw Error('offline');}return row({revision:latest?8:3});}});
 await f.manager.open();await f.node('[data-public-check]').onclick();assert.equal(f.node('[data-public-error]').textContent,'offline');assert.equal(f.node('[name=code]').disabled,false);
 badCheck=true;await f.node('[data-public-check]').onclick();assert.match(f.node('[data-public-error]').textContent,/檢查結果/);
 await f.submit();assert.match(f.node('[data-public-error]').textContent,/REVISION/);assert.equal(f.saved.length,0);assert.equal(f.node('[data-public-current]').value,'https://paparty.app/pa');
 latest=true;await f.node('[data-public-reload]').onclick();await f.submit();assert.equal(f.calls.at(-1).revision,8);
});

test('switching scope or closing the dialog ignores late mutation results and blocks old form events',async()=>{
 const pending=deferred(),f=fixture({api:body=>body.op==='publicRouteSave'?pending.promise:row()});
 await f.manager.open();const old=f.form;await f.submit();f.setActor({...owner,streamerId:'mimi'});pending.resolve(row({revision:4,changed:true}));await settle();
 assert.equal(f.saved.length,0);assert.equal(f.toasts.length,0);await old.querySelector('[data-public-check]').onclick();assert.equal(f.calls.length,2);
 const g=fixture();await g.manager.open();g.dialog.open=false;await g.node('[data-public-copy]').onclick();assert.equal(g.copies.length,0);await g.submit();assert.equal(g.calls.length,1);
});

test('independent hall namespace is fixed pa and cannot be overwritten by its editable input',async()=>{
 const f=fixture({identity:{...owner,role:'super_admin',spaceId:'space-Q'},api:async body=>row({kind:'hall',spaceId:'space-Q',streamerId:null,streamerSlug:null,configured:false,layout:null,spaceCode:null,code:null,canonicalPath:null,...(body.op==='publicRouteCheck'?{available:true,proposedPath:null}:{})})});
 await f.manager.open({kind:'hall'});f.node('[name=code]').value='qq';f.node('[name=layout]').value='independent';f.form.onchange();assert.equal(f.node('[name=code]').value,'pa');assert.equal(f.node('[name=code]').readOnly,true);
 f.node('[name=code]').value='wrong';await f.node('[data-public-check]').onclick();assert.equal(f.calls.at(-1).code,'pa');assert.equal(f.calls.at(-1).layout,'independent');
 f.node('[name=layout]').value='hall';f.form.onchange();assert.equal(f.node('[name=code]').value,'qq');assert.equal(f.node('[name=code]').readOnly,false);
});

test('a configured independent namespace has no lobby URL and preserves its immutable layout',async()=>{
 const independent=row({kind:'hall',spaceId:'space-Q',streamerId:null,streamerSlug:null,layout:'independent',spaceCode:'pa',code:'pa',canonicalPath:null});
 const f=fixture({identity:{...owner,role:'super_admin',spaceId:'space-Q'},api:async body=>({...independent,...(body.op==='publicRouteCheck'?{available:true,proposedPath:null}:{})})});
 await f.manager.open({kind:'hall'});assert.equal(f.node('[name=layout]').disabled,true);assert.equal(f.node('[name=code]').readOnly,true);assert.equal(f.node('[data-public-preview]').disabled,true);
 f.node('[name=layout]').value='hall';f.form.onchange();await f.node('[data-public-check]').onclick();assert.equal(f.calls.at(-1).layout,'independent');assert.equal(f.calls.at(-1).code,'pa');assert.match(f.node('[data-public-status]').textContent,/沒有大廳首頁/);assert.equal(f.node('[name=layout]').disabled,true);
});

test('unconfigured metadata disables share/copy and successful-save callback failure does not claim the save failed',async()=>{
 const f=fixture({api:async body=>body.op==='publicRouteSave'?row({changed:true,revision:4}):row({configured:false,canonicalPath:null,code:null}),onSaved:async()=>{throw Error('sync failed');}});
 await f.manager.open();assert.equal(f.node('[data-public-preview]').disabled,true);assert.equal(f.node('[data-public-copy]').disabled,true);
 f.node('[name=code]').value='pa';await f.submit();assert.match(f.node('[data-public-error]').textContent,/網址已儲存/);assert.equal(f.node('[name=code]').disabled,false);assert.equal(f.node('[data-public-current]').value,'https://paparty.app/pa');
});

test('public-link cache invalidation rejects in-flight stale identity results while reusing current scope reads',async()=>{
 const old=deferred(),newer=deferred(),calls=[];
 const client=createPublicLinkClient({api:body=>{calls.push(body);return calls.length===1?old.promise:newer.promise;}}),scope={spaceId:'space-001',streamerId:'papa'};
 const first=client.info(scope),rejected=assert.rejects(first,/身分已變更/);await settle();client.invalidate();const second=client.info(scope);await settle();old.resolve(row());await rejected;newer.resolve(row({canonicalPath:'/PAPA520',token:'private'}));
 assert.equal(client.shareUrl(await second),'https://paparty.app/PAPA520');const cached=await client.info(scope);assert.equal(cached.token,undefined);assert.equal(calls.length,2);
});

test('metadata invalidated before its scheduled request never makes a redundant API call',async()=>{
 let calls=0;const client=createPublicLinkClient({api:async()=>{calls++;return row();}});
 const pending=client.info({spaceId:'space-001',streamerId:'papa'});client.invalidate();
 await assert.rejects(pending,/身分已變更/);assert.equal(calls,0);
});
