import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebNotificationHealth} from '../src/web-notification-health.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function environment({secure=true,permission='granted',registration=true,subscription=true}={}){
 let reads=0,prompts=0,registrations=0;
 const reg={pushManager:{getSubscription:async()=>subscription?{endpoint:'https://private.example/push-secret'}:null}};
 const env={isSecureContext:secure,Notification:{permission,requestPermission(){prompts++;throw Error('must not prompt');}},PushManager:class{},navigator:{serviceWorker:{getRegistration:async()=>{reads++;return registration?reg:undefined;},register(){registrations++;throw Error('must not register');}}}};
 return {env,reg,reads:()=>reads,prompts:()=>prompts,registrations:()=>registrations};
}

test('health checks existing local capability/subscription on demand, coalesce, and do not expose endpoint or prompt',async()=>{
 const fixture=environment(),pending=deferred();let time=1000;
 fixture.reg.pushManager.getSubscription=()=>pending.promise;
 const health=createWebNotificationHealth({environment:fixture.env,registrationUrl:'https://party.example/',now:()=>time});
 assert.equal(fixture.reads(),0);assert.equal(health.snapshot().checkedAt,null);
 const first=health.check(),second=health.check();assert.equal(first,second);
 await Promise.resolve();assert.equal(fixture.reads(),1);assert.equal(health.snapshot().checking,true);
 pending.resolve({endpoint:'https://private.example/push-secret',keys:{secret:'hidden'}});await first;
 assert.equal(health.snapshot().worker,'ready');assert.equal(health.snapshot().subscription,'present');assert.equal(health.snapshot().checkedAt,1000);
 assert.ok(!JSON.stringify(health.snapshot()).includes('push-secret'));assert.equal(fixture.prompts(),0);assert.equal(fixture.registrations(),0);
 time=2000;await health.check();assert.equal(fixture.reads(),2);assert.equal(health.snapshot().checkedAt,2000);
});

for(const [name,options,expected] of [['missing registration',{registration:false},['missing','missing']],['missing subscription',{subscription:false},['ready','missing']],['denied permission',{permission:'denied'},['ready','present']],['insecure origin',{secure:false},['unsupported','unsupported']]]){
 test(`health reports ${name} without trying to repair it`,async()=>{
  const fixture=environment(options),health=createWebNotificationHealth({environment:fixture.env});await health.check();
  assert.deepEqual([health.snapshot().worker,health.snapshot().subscription],expected);assert.equal(fixture.prompts(),0);assert.equal(fixture.registrations(),0);
  assert.equal(fixture.reads(),options.secure===false?0:1);
 });
}

test('unsupported browser and local read failure remain observations, not delivery results',async()=>{
 const unsupported=createWebNotificationHealth({environment:{isSecureContext:true}});await unsupported.check();
 assert.equal(unsupported.snapshot().notificationSupported,false);assert.equal(unsupported.snapshot().permission,'unsupported');
 const fixture=environment();fixture.env.navigator.serviceWorker.getRegistration=async()=>{throw Error('local lookup unavailable');};
 const health=createWebNotificationHealth({environment:fixture.env});await health.check();
 assert.equal(health.snapshot().error,'local lookup unavailable');assert.equal(health.snapshot().worker,'error');assert.equal(health.snapshot().binding.successAt,null);
});

test('binding outcomes are local to the current identity and stale checks cannot overwrite reset/new checks',async()=>{
 const fixture=environment(),old=deferred();let reads=0,time=1000;
 fixture.env.navigator.serviceWorker.getRegistration=()=>++reads===1?old.promise:Promise.resolve(fixture.reg);
 const health=createWebNotificationHealth({environment:fixture.env,now:()=>time});
 health.recordBinding('attempt');time=2000;health.recordBinding('error',Error('network failure'));
 assert.equal(health.snapshot().binding.error,'network failure');assert.equal(health.snapshot().binding.successAt,null);
 const stale=health.check();await Promise.resolve();health.reset();time=3000;
 assert.deepEqual(health.snapshot().binding,{attemptAt:null,successAt:null,error:'',inFlight:false});
 await health.check();old.resolve(undefined);await stale;assert.equal(health.snapshot().subscription,'present');assert.equal(health.snapshot().checkedAt,3000);
 health.recordBinding('attempt');time=4000;health.recordBinding('success');assert.deepEqual(health.snapshot().binding,{attemptAt:3000,successAt:4000,error:'',inFlight:false});
 const snapshot=health.snapshot();snapshot.binding.successAt=0;assert.equal(health.snapshot().binding.successAt,4000,'snapshots cannot mutate controller state');
});

test('a reentrant observer sees the same pending health check',async()=>{
 const fixture=environment();let health,reentrant;
 health=createWebNotificationHealth({environment:fixture.env,onChange:state=>{if(state.checking&&!reentrant)reentrant=health.check();}});
 const result=health.check();assert.equal(reentrant,result);await result;assert.equal(fixture.reads(),1);
});
