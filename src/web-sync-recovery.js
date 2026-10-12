// One scoped read at a time. Form editing delays rendering, never state reads.
// Writes are intentionally outside this coordinator and are never replayed.
export function createWebSyncRecovery({contextKey,canRead,canRender,read,apply,render,onError=()=>{},schedule=(callback,delay)=>setTimeout(callback,delay),cancel=id=>clearTimeout(id),maxRetries=3}){
 let pending=false,forcePending=false,running=null,renderPending=false,renderContext=null;
 let retries=0,timer=null,retryPaused=false,retryDelay=0,exhausted=false,sequence=0,error=null,reason=null;
 let observedContext=contextKey();
 const waiters=[];
 const report=(failure,details)=>{try{onError(failure,details);}catch{/* Error presentation cannot create another read. */}};
 const snapshot=()=>({pending,reading:!!running,renderPending,retries,error,reason,retryScheduled:timer!==null,retryPaused});
 const retryLimit=Math.min(3,Math.max(0,Number.isSafeInteger(maxRetries)?maxRetries:3));
 const transient=failure=>!failure?.authExpired&&!failure?.permanent&&failure?.retryable!==false&&(!Number.isInteger(failure?.status)||failure.status===408||failure.status===429||failure.status>=500);
 function observeContext(){
  const current=contextKey();if(current===observedContext)return;
  observedContext=current;if(timer!==null){cancel(timer);timer=null;}
  retries=0;retryPaused=false;retryDelay=0;exhausted=false;error=null;
  if(renderContext!==current){renderPending=false;renderContext=null;}
  if(running){pending=true;deferWaiters(running);}
 }
 function pauseRetry(){if(timer!==null){cancel(timer);timer=null;retryPaused=true;}}
 function settle(through,failure){for(let index=waiters.length-1;index>=0;index--){const waiter=waiters[index];if(failure||waiter.sequence<=through){waiters.splice(index,1);failure?waiter.reject(failure):waiter.resolve(snapshot());}}}
 function deferWaiters(job){for(const waiter of waiters)if(waiter.sequence<=job.sequence)waiter.sequence=job.sequence+1;}
 function flushRender(){
  if(!renderPending)return false;
  if(renderContext!==contextKey()){renderPending=false;renderContext=null;return false;}
  if(!canRender())return false;
  try{render();renderPending=false;return true;}catch(failure){report(failure,{phase:'render'});return false;}
 }
 function retryLater(){
  if(!canRead()){retryPaused=true;return;}
  retryPaused=false;
  timer=schedule(()=>{timer=null;if(!canRead()){retryPaused=true;return;}pump();},retryDelay);
 }
 function fail(job,failure,readFailure){
  error=failure;pending=true;forcePending=forcePending||job.force;
  if(readFailure&&transient(failure)&&retries<retryLimit){
   retries++;retryDelay=3000*2**(retries-1);deferWaiters(job);
   report(failure,{phase:'read',retry:retries,retryIn:retryDelay,context:job.context});retryLater();
  }else{
   pending=false;forcePending=false;retryPaused=false;exhausted=true;
   report(failure,{phase:readFailure?'read':'apply',retry:null,context:job.context});
   if(running===job)running=null;settle(Infinity,failure);
  }
 }
 function pump(){
  observeContext();
  if(!canRead()){pauseRetry();return;}
  if(running||timer!==null||!pending)return;
  if(retryPaused){retryLater();return;}
  const job={sequence:++sequence,context:contextKey(),force:forcePending};
  pending=false;forcePending=false;running=job;
  Promise.resolve().then(()=>read(job.force,job.context)).then(result=>{
   if(job.context!==contextKey()||!canRead()){
    pending=true;forcePending=forcePending||job.force;deferWaiters(job);return;
   }
   try{
    const changed=apply(result,job.context);
    if(changed!==false){renderPending=true;renderContext=job.context;}
    retries=0;error=null;exhausted=false;flushRender();
    // Awaiting callers may request another read before this promise chain's
    // finally runs. A completed slot must never accept those new waiters.
    if(running===job)running=null;settle(job.sequence);
   }catch(failure){fail(job,failure,false);}
  },failure=>{
   if(job.context!==contextKey()){
    pending=true;forcePending=forcePending||job.force;deferWaiters(job);return;
   }
   fail(job,failure,true);
  }).finally(()=>{if(running===job)running=null;pump();});
 }
 function freshRequest(){if(exhausted){retries=0;retryDelay=0;retryPaused=false;error=null;exhausted=false;}}
 function refresh(force=false){
  observeContext();freshRequest();
  const needsNext=!running||force||pending;
  if(needsNext){pending=true;forcePending=forcePending||!!force;}
  const wanted=running&&!needsNext?running.sequence:sequence+1;
  const promise=new Promise((resolve,reject)=>waiters.push({sequence:wanted,resolve,reject}));pump();return promise;
 }
 function invalidate(nextReason='changed'){observeContext();freshRequest();reason=nextReason;pending=true;pump();return snapshot();}
 function resume(){observeContext();if(exhausted){freshRequest();pending=true;}flushRender();pump();return snapshot();}
 return {refresh,invalidate,resume,flushRender,snapshot};
}
