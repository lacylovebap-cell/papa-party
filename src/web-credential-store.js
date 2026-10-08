// Browser encryption at rest, not an XSS boundary. Refresh credentials never
// enter localStorage/URLs. Native clients supply their OS secure-store adapter.
export function createWebCredentialStore({indexedDB,crypto,locks,namespace='pa-party-device-v1'}){
 if(!indexedDB||!crypto?.subtle||!locks?.request)throw Error('此瀏覽器無法安全協調裝置登入，請使用一般登入');
 let opening;
 function open(){return opening||=new Promise((resolve,reject)=>{
  const r=indexedDB.open(namespace,1);
  r.onupgradeneeded=()=>r.result.createObjectStore('credentials');
  r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();opening=null;};resolve(r.result);};
  r.onerror=()=>{opening=null;reject(r.error);};r.onblocked=()=>{opening=null;reject(Error('裝置儲存尚未準備好'));};
 });}
 async function operation(mode,run){const db=await open();return new Promise((resolve,reject)=>{
  const tx=db.transaction('credentials',mode),request=run(tx.objectStore('credentials'));let value;
  request.onsuccess=()=>value=request.result;
  tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('裝置儲存未完成'));tx.onerror=()=>reject(tx.error);
 });}
 const read=key=>operation('readonly',s=>s.get(key));
 const write=(key,value)=>operation('readwrite',s=>s.put(value,key));
 async function encryptionKey(){const saved=await read('encryption-key');if(saved)return saved;
  // Called under the shared role lock. Key creation uses a separate global lock
  // because player and manager credentials can be created simultaneously.
  return locks.request(namespace+'-key',async()=>{const current=await read('encryption-key');if(current)return current;
   const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await write('encryption-key',key);return key;
  });
 }
 return {
  lock:(key,run)=>locks.request(namespace+'-'+key,run),
  store:{
   async get(key){const saved=await read('record-'+key);if(!saved)return null;
    const secret=await read('encryption-key');if(!secret)throw Error('裝置登入資料無法解密，請重新登入');
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:saved.iv,additionalData:new TextEncoder().encode(namespace+':'+key)},secret,saved.body);
    return JSON.parse(new TextDecoder().decode(bytes));
   },
   async set(key,value){const secret=await encryptionKey(),iv=crypto.getRandomValues(new Uint8Array(12));
    const body=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(namespace+':'+key)},secret,new TextEncoder().encode(JSON.stringify(value)));
    await write('record-'+key,{iv,body});
   },
   remove:key=>operation('readwrite',s=>s.delete('record-'+key))
  }
 };
}
