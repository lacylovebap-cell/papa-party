import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTICE_TYPES,noticePushWindow} from '../src/notification-rules.js';
test('every notification type has a bounded shrinking push lifetime independent of persisted record',()=>{
 const now=Date.parse('2026-10-31T00:00:00Z');
 for(const type of Object.keys(NOTICE_TYPES)){
  const n={id:'original',type,created_at:new Date(now).toISOString(),read_at:null};
  const before=JSON.stringify(n),first=noticePushWindow(n,now);
  assert.ok(first.ttl>0&&first.ttl<=86400,type);
  assert.equal(noticePushWindow(n,now+1000).ttl,first.ttl-1);
  assert.equal(noticePushWindow(n,first.expiresAt).ttl,0);
  assert.equal(JSON.stringify(n),before);
 }
 assert.equal(noticePushWindow({type:'ready',created_at:'invalid'},now).ttl,0);
});
