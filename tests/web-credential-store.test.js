import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createWebCredentialStore} from '../src/web-credential-store.js';

import {storage} from './helpers/web-storage.js';

test('refresh credentials persist encrypted with a nonextractable key, survive adapter restart, and bind to role',async()=>{
 const f=storage(),create=()=>createWebCredentialStore({...f,crypto:webcrypto});
 const a=create(),b=create(),record={sessionId:'device',refreshToken:'refresh:secret',role:'player'};
 await Promise.all([a.store.set('player',record),b.store.set('manager',{...record,role:'super_admin'})]);
 const key=f.rows.get('encryption-key');assert.equal(key.extractable,false);
 await assert.rejects(webcrypto.subtle.exportKey('raw',key));
 const persisted=f.rows.get('record-player');
 assert.equal(Buffer.from(persisted.body).includes(Buffer.from(record.refreshToken)),false);
 assert.deepEqual(await b.store.get('player'),record);
 f.rows.set('record-manager',structuredClone(persisted));
 await assert.rejects(b.store.get('manager'),/operation|failed/i,'role swap cannot decrypt');
 await a.store.remove('player');assert.equal(await b.store.get('player'),null);
});

test('tampered ciphertext and missing key fail closed; committed storage failures reject',async()=>{
 const f=storage(),a=createWebCredentialStore({...f,crypto:webcrypto});
 await a.store.set('player',{refreshToken:'refresh:secret'});
 const row=f.rows.get('record-player');new Uint8Array(row.body)[0]^=1;
 await assert.rejects(a.store.get('player'));
 f.rows.delete('encryption-key');await assert.rejects(a.store.get('player'),/無法解密/);
 f.abortNext=true;await assert.rejects(a.store.remove('player'),/disk unavailable/);
});

test('unsupported browsers fall back explicitly; shared locks serialize across adapters',async()=>{
 assert.throws(()=>createWebCredentialStore({}),/一般登入/);
 const f=storage(),a=createWebCredentialStore({...f,crypto:webcrypto}),b=createWebCredentialStore({...f,crypto:webcrypto});
 let active=0,peak=0;
 await Promise.all([a,b,a,b].map(adapter=>adapter.lock('player',async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;})));
 assert.equal(peak,1);
});
