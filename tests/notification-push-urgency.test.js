import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const bundle=fs.readFileSync(new URL('../ops/edge-release/party-api-10.31-PUSH.1.js',import.meta.url),'utf8');
const deployed=fs.readFileSync(new URL('../ops/edge-release/party-api-10.31-NOTICE.1.js',import.meta.url),'utf8');

test('Web Push is sent with Urgency: high so locked / dozing Android phones deliver immediately',()=>{
 for(const text of [source,bundle])assert.match(text,/generateRequestDetails\(sub\.subscription,payload,\{[^}]*\},TTL:pushWindow\.ttl,urgency:'high'\}\)/);
});

test('PUSH.1 bundle equals deployed NOTICE.1 except urgency, the diagnostic op, its routing and releaseInfo',()=>{
 const a=bundle.split('\n').slice(1),b=deployed.split('\n');
 const changed=a.filter(line=>!b.includes(line));
 assert.equal(changed.length,4,changed.map(l=>l.slice(0,80)).join('\n'));
 assert.ok(changed.some(l=>l.includes("if(b.op==='pushDiagnostic')")));
 assert.ok(changed.some(l=>l.includes('"pushKey", "pushDiagnostic", "pushSubscribe"')));
 assert.ok(changed.some(l=>l.includes('version: "10.31-PUSH.1"')));
});

test('pushDiagnostic logs only whitelisted, bounded fields with server-derived recipient',async()=>{
 const line=bundle.split('\n').find(l=>l.includes("if(b.op==='pushDiagnostic')"));
 const body=line.trim();
 const logs=[];
 const run=new Function('b','who','room','recipient','console',`return (async()=>{${body.replace(/^if\(b\.op==='pushDiagnostic'\)\{/,'').replace(/\}$/,'')}})();`);
 const result=await run({diagnostic:{permission:'default',supported:true,inApp:'yes',endpointHost:'fcm.googleapis.com',token:'secret',endpoint:'https://fcm/x',error:'權限 被拒'.repeat(30)}},{deviceSessionId:'d1'},'papa','P1',{log:m=>logs.push(m)});
 assert.deepEqual(result,{ok:true});
 const record=JSON.parse(logs[0].replace(/^PUSH_DIAG /,''));
 assert.equal(record.recipient,'P1');assert.equal(record.room,'papa');assert.equal(record.device,'d1');
 assert.equal(record.permission,'default');assert.equal(record.inApp,'yes');
 assert.equal('token' in record,false);assert.equal('endpoint' in record,false,'no endpoint secret logged');
 assert.ok(record.error.length<=80&&!record.error.includes(' '));
});
