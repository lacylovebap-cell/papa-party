// A transaction-completion stub only; encryption and structured cloning use
// the real platform APIs. This verifies persisted bytes, not cipher mocks.
export function storage(){
 const rows=new Map(),tails=new Map();let abortNext=false;
 const locks={request:async(key,run)=>{const old=tails.get(key)||Promise.resolve(),next=old.catch(()=>{}).then(run);tails.set(key,next);return next;}};
 const db={createObjectStore(){},close(){},transaction(){
  const tx={objectStore(){return {get:key=>request(()=>structuredClone(rows.get(key))),put:(value,key)=>request(()=>{rows.set(key,structuredClone(value));return key;}),delete:key=>request(()=>rows.delete(key))};}};
  function request(run){const r={};setImmediate(()=>{if(abortNext){abortNext=false;tx.error=Error('disk unavailable');tx.onabort?.();return;}try{r.result=run();r.onsuccess?.();setImmediate(()=>tx.oncomplete?.());}catch(error){tx.error=error;tx.onabort?.();}});return r;}return tx;
 }};
 let initialized=false;
 const indexedDB={open(){const r={};setImmediate(()=>{r.result=db;if(!initialized){r.onupgradeneeded?.();initialized=true;}r.onsuccess?.();});return r;}};
 return {rows,locks,indexedDB,set abortNext(value){abortNext=value;}};
}
