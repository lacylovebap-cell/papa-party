import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8');
const line=source.split('\n').find(line=>line.includes("b.op.startsWith('platform')"));
assert.ok(line,'shipping handler must guard the whole platform namespace');
const check=new Function('b','who','isSuper',line),isSuper=who=>who?.role==='super_admin';
test('all platform reads and writes reject player, hall, streamer and missing Account actors',()=>{
 for(const op of ['platformManagementDirectory','platformManagementDetail','platformManageSpace','platformManagementDependencies','platformStreamerSave','platformStreamerCredentials','platformDirectory','platformFutureOperation']){
  for(const who of [null,{role:'player',accountId:'p'},{role:'space_admin',accountId:'h'},{role:'streamer_admin',accountId:'s'},{role:'super_admin'}]){
   assert.throws(()=>check({op,role:'super_admin',accountId:'forged'},who,isSuper),/僅限總裁/);
  }
  assert.doesNotThrow(()=>check({op},{role:'super_admin',accountId:'verified'},isSuper));
 }
});
test('president guard leaves ordinary streamer business operations in their existing own-room ACL',()=>{
 for(const op of ['read','mutate','achievementManagement','catalogBatchAdd'])assert.doesNotThrow(()=>check({op},{role:'streamer_admin',accountId:'s'},isSuper));
});
