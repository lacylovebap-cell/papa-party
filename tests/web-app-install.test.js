import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebAppInstall} from '../src/web-app-install.js';

class Target{
 listeners=new Map();
 addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
 removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
 dispatch(type,event={}){for(const listener of [...(this.listeners.get(type)||[])])listener({type,...event});}
 count(){return [...this.listeners.values()].reduce((sum,listeners)=>sum+listeners.size,0);}
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture({standalone=false,safari=false,legacy=false}={}){
 const target=new Target(),media=new Target();media.matches=standalone;
 if(legacy){media.addListener=listener=>Target.prototype.addEventListener.call(media,'change',listener);media.removeListener=listener=>Target.prototype.removeEventListener.call(media,'change',listener);media.addEventListener=undefined;media.removeEventListener=undefined;}
 const environment={navigator:{standalone:safari},matchMedia(query){assert.equal(query,'(display-mode: standalone)');return media;}};
 const controller=createWebAppInstall({environment,target});
 const install=({choice=deferred(),prompt=()=>{},trusted=true}={})=>{
  const calls={prevented:0,prompted:0};
  const event={isTrusted:trusted,preventDefault(){calls.prevented++;},prompt(){calls.prompted++;return prompt();},userChoice:choice.promise};
  target.dispatch('beforeinstallprompt',event);
  return {choice,calls};
 };
 return {target,media,environment,controller,install};
}

test('unsupported browsers retain manual install mode without permissions, persistence or eager prompt',async()=>{
 const location={href:'https://paparty.app/?streamer=papa&space=my-space#center'};
 const environment={location,navigator:{},get localStorage(){throw Error('storage must not be used');},get Notification(){throw Error('permission must not be used');},get fetch(){throw Error('network must not be used');}};
 const controller=createWebAppInstall({environment});
 assert.deepEqual(controller.snapshot(),{installed:false,canPrompt:false,prompting:false,error:''});
 assert.deepEqual(await controller.prompt(),{outcome:'unavailable'});
 assert.equal(location.href,'https://paparty.app/?streamer=papa&space=my-space#center');
 controller.destroy();
});

test('only a usable browser install event is intercepted and one event is retained',async()=>{
 const f=fixture();let prevented=0;
 const preventDefault=()=>{prevented++;};
 f.target.dispatch('beforeinstallprompt',{preventDefault});
 f.target.dispatch('beforeinstallprompt',{preventDefault,prompt(){}});
 const synthetic=f.install({trusted:false});
 assert.equal(prevented,0);assert.equal(synthetic.calls.prevented,0);
 assert.equal(f.controller.snapshot().canPrompt,false);
 const first=f.install(),second=f.install();
 assert.equal(first.calls.prevented,1);assert.equal(second.calls.prevented,1);
 assert.equal(first.calls.prompted,0);assert.equal(second.calls.prompted,0,'install events do not prompt eagerly');
 const pending=f.controller.prompt();first.choice.resolve({outcome:'dismissed'});
 assert.deepEqual(await pending,{outcome:'dismissed'});
 assert.equal(first.calls.prompted,1);assert.equal(second.calls.prompted,0,'the later event never replaces the held event');
 f.controller.destroy();
});

test('prompt runs inside the initiating gesture and repeated clicks share one pending promise',async()=>{
 const f=fixture();let gesture=false;
 const event=f.install({prompt(){assert.equal(gesture,true,'prompt must execute before returning to the caller');}});
 gesture=true;const first=f.controller.prompt();gesture=false;
 const second=f.controller.prompt();
 assert.strictEqual(first,second);assert.equal(event.calls.prompted,1);
 assert.deepEqual(f.controller.snapshot(),{installed:false,canPrompt:false,prompting:true,error:''});
 event.choice.resolve({outcome:'accepted',platform:'web'});
 assert.deepEqual(await first,{outcome:'accepted'});
 assert.deepEqual(f.controller.snapshot(),{installed:false,canPrompt:false,prompting:false,error:''},'accepted is not proof of installation');
 assert.deepEqual(await f.controller.prompt(),{outcome:'unavailable'},'an event is consumed once');
 f.controller.destroy();
});

test('dismissal permits a new browser opportunity without automatically reopening the prompt',async()=>{
 const f=fixture(),first=f.install();
 const a=f.controller.prompt();first.choice.resolve({outcome:'dismissed'});await a;
 assert.equal(f.controller.snapshot().canPrompt,false);
 const next=f.install();assert.equal(f.controller.snapshot().canPrompt,true);assert.equal(next.calls.prompted,0);
 const b=f.controller.prompt();next.choice.resolve({outcome:'accepted'});
 assert.deepEqual(await b,{outcome:'accepted'});assert.equal(next.calls.prompted,1);
 f.target.dispatch('appinstalled');assert.equal(f.controller.snapshot().installed,true);
 f.controller.destroy();
});

test('a synchronous prompt failure is surfaced safely and cannot reuse the consumed event',async()=>{
 const f=fixture(),event=f.install({prompt(){throw Error('vendor failure contains private details');}});
 const result=await f.controller.prompt();
 assert.equal(result.outcome,'error');assert.equal(f.controller.snapshot().prompting,false);
 assert.equal(f.controller.snapshot().error.includes('private'),false);
 assert.equal(f.controller.snapshot().error,result.error);
 assert.deepEqual(await f.controller.prompt(),{outcome:'unavailable'});assert.equal(event.calls.prompted,1);
 f.install();assert.equal(f.controller.snapshot().error,'');assert.equal(f.controller.snapshot().canPrompt,true);
 f.controller.destroy();
});

test('rejection from either vendor promise is handled and clears the pending state',async()=>{
 for(const rejectPrompt of [false,true]){
  const f=fixture(),prompted=deferred(),event=f.install({prompt:()=>prompted.promise});
  const pending=f.controller.prompt();
  if(rejectPrompt){prompted.reject(Error('prompt failed'));event.choice.resolve({outcome:'accepted'});}
  else{prompted.resolve();event.choice.reject(Error('choice failed'));}
  assert.equal((await pending).outcome,'error');assert.equal(f.controller.snapshot().prompting,false);
  assert.equal(f.controller.snapshot().canPrompt,false);assert.ok(f.controller.snapshot().error);
  f.controller.destroy();
 }
});

test('an invalid choice never becomes a successful installation',async()=>{
 const f=fixture(),event=f.install(),pending=f.controller.prompt();event.choice.resolve({outcome:'unexpected'});
 assert.equal((await pending).outcome,'error');assert.equal(f.controller.snapshot().installed,false);
 f.controller.destroy();
});

test('a thrown prompt and its rejected userChoice are both handled',async()=>{
 const f=fixture(),choice=deferred();
 f.install({choice,prompt(){choice.reject(Error('choice unavailable'));throw Error('gesture unavailable');}});
 assert.equal((await f.controller.prompt()).outcome,'error');
 await Promise.resolve();assert.equal(f.controller.snapshot().prompting,false);
 f.controller.destroy();
});

test('appinstalled completes an outstanding prompt and ignores its stale dismissed result',async()=>{
 const f=fixture(),event=f.install(),pending=f.controller.prompt();
 f.target.dispatch('appinstalled');
 assert.deepEqual(await pending,{outcome:'installed'});
 assert.deepEqual(f.controller.snapshot(),{installed:true,canPrompt:false,prompting:false,error:''});
 event.choice.resolve({outcome:'dismissed'});await Promise.resolve();await Promise.resolve();
 assert.deepEqual(f.controller.snapshot(),{installed:true,canPrompt:false,prompting:false,error:''});
 const later=f.install();assert.equal(later.calls.prevented,0);
 assert.deepEqual(await f.controller.prompt(),{outcome:'installed'});assert.equal(later.calls.prompted,0);
 f.controller.destroy();
});

test('confirmed installation ignores a late rejected choice without reviving an error',async()=>{
 const f=fixture(),event=f.install(),pending=f.controller.prompt();f.target.dispatch('appinstalled');await pending;
 event.choice.reject(Error('late failure'));await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(f.controller.snapshot().error,'');assert.equal(f.controller.snapshot().installed,true);
 f.controller.destroy();
});

test('standalone and Safari launches start installed without invoking or intercepting a prompt',async()=>{
 for(const options of [{standalone:true},{safari:true}]){
  const f=fixture(options),event=f.install();
  assert.equal(f.controller.snapshot().installed,true);assert.equal(event.calls.prevented,0);
  assert.deepEqual(await f.controller.prompt(),{outcome:'installed'});assert.equal(event.calls.prompted,0);
  f.controller.destroy();
 }
});

test('a display-mode change confirms installation and supersedes a pending prompt',async()=>{
 const f=fixture(),event=f.install(),pending=f.controller.prompt();
 f.media.matches=true;f.media.dispatch('change');
 assert.deepEqual(await pending,{outcome:'installed'});assert.equal(f.controller.snapshot().installed,true);
 event.choice.resolve({outcome:'accepted'});await Promise.resolve();await Promise.resolve();
 assert.equal(f.controller.snapshot().prompting,false);
 f.controller.destroy();
});

test('legacy media listeners observe standalone mode and are detached during cleanup',()=>{
 const f=fixture({legacy:true});assert.equal(f.media.count(),1);
 f.media.matches=true;f.media.dispatch('change');assert.equal(f.controller.snapshot().installed,true);
 f.controller.destroy();assert.equal(f.media.count(),0);assert.equal(f.target.count(),0);
});

test('destroy completes a pending caller, detaches listeners and ignores stale results',async()=>{
 const f=fixture(),event=f.install(),pending=f.controller.prompt();let updates=0;
 f.controller.subscribe(()=>{updates++;});
 f.controller.destroy();f.controller.destroy();
 assert.deepEqual(await pending,{outcome:'unavailable'});
 assert.equal(f.target.count(),0);assert.equal(f.media.count(),0);
 const afterDestroy=updates;
 event.choice.resolve({outcome:'accepted'});await Promise.resolve();await Promise.resolve();
 f.target.dispatch('appinstalled');f.media.matches=true;f.media.dispatch('change');f.install();
 assert.equal(updates,afterDestroy);
 assert.deepEqual(f.controller.snapshot(),{installed:false,canPrompt:false,prompting:false,error:''});
 assert.deepEqual(await f.controller.prompt(),{outcome:'unavailable'});
});

test('subscribers receive fresh snapshots, can unsubscribe and cannot mutate internal state',()=>{
 const f=fixture(),updates=[];
 const unsubscribe=f.controller.subscribe(state=>{updates.push(state);state.installed=true;});
 assert.equal(updates.length,1);assert.equal(f.controller.snapshot().installed,false);
 f.install();assert.equal(updates.length,2);assert.equal(f.controller.snapshot().canPrompt,true);
 unsubscribe();f.target.dispatch('appinstalled');assert.equal(updates.length,2);
 assert.equal(f.controller.snapshot().installed,true);f.controller.destroy();
});

test('a failed subscriber cannot break event handling or the prompt gesture',async()=>{
 const f=fixture();f.controller.subscribe(()=>{throw Error('UI failure');});
 const event=f.install();assert.equal(f.controller.snapshot().canPrompt,true);
 const pending=f.controller.prompt();event.choice.resolve({outcome:'dismissed'});
 assert.deepEqual(await pending,{outcome:'dismissed'});assert.equal(event.calls.prompted,1);
 f.controller.destroy();
});
