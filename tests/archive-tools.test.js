import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=new URL('../',import.meta.url);
const script=relative=>new URL(relative,root).pathname;
const columns=['id','streamer_id','entity_kind','entity_id','action','actor_role','actor_player_id',
  'created_at','effective_at','before_data','after_data','hour_bucket','actor_account_id',
  'actor_streamer_id','actor_display_name_snapshot','target_player_id','target_player_name_snapshot','space_id'];
function fixture(id){return Object.fromEntries(columns.map(k=>[k,null]).map(([k,v])=>[k,k==='id'?id:k==='created_at'?'2026-10-20T13:30:11.123456Z':v]));}
function run(file,args=[],env={}){return spawnSync(process.execPath,[script(file),...args],{encoding:'utf8',env:{...process.env,...env}});}
function temp(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pa-archive-test-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  return dir;
}
test('validates complete local archive and creates privacy-safe manifest',t=>{
  const dir=temp(t),input=path.join(dir,'events.jsonl'),manifest=path.join(dir,'manifest.json');
  fs.writeFileSync(input,JSON.stringify(fixture(1))+'\n'+JSON.stringify(fixture(2))+'\n');
  const result=run('tools/archive/inspect-jsonl.mjs',['--file',input,'--expected-rows','2','--manifest-output',manifest]);
  assert.equal(result.status,0,result.stderr);
  const details=JSON.parse(fs.readFileSync(manifest,'utf8'));
  assert.equal(details.rows,2);
  assert.equal(details.checks.complete_columns,true);
  assert.equal(details.checks.original_database_contents_verified,false);
  assert.equal(details.checks.restore_test_passed,false);
  assert.equal(details.min_event_id,'1');
});
test('rejects missing columns and incorrect expected counts',t=>{
  const dir=temp(t),input=path.join(dir,'incomplete.jsonl');
  fs.writeFileSync(input,JSON.stringify({id:1})+'\n');
  assert.notEqual(run('tools/archive/inspect-jsonl.mjs',['--file',input]).status,0);
  fs.writeFileSync(input,JSON.stringify(fixture(9))+'\n');
  assert.notEqual(run('tools/archive/inspect-jsonl.mjs',['--file',input,'--expected-rows','256876']).status,0);
});
test('AES-256-GCM encryption restores exactly and fails closed on wrong key',t=>{
  const dir=temp(t),input=path.join(dir,'raw.jsonl.gz'),encrypted=path.join(dir,'raw.jsonl.gz.enc'),decrypted=path.join(dir,'roundtrip.jsonl.gz');
  fs.writeFileSync(input,Buffer.from('secret PA Party archive test data.'));
  const valid='Example-passphrase-kept-outside-GitHub-999';
  assert.equal(run('tools/archive/archive-crypt.mjs',['encrypt',input,encrypted],{PA_ARCHIVE_PASSPHRASE:valid}).status,0);
  assert.equal(run('tools/archive/archive-crypt.mjs',['decrypt',encrypted,decrypted],{PA_ARCHIVE_PASSPHRASE:valid}).status,0);
  assert.deepEqual(fs.readFileSync(decrypted),fs.readFileSync(input));
  const wrong=path.join(dir,'wrong.bin');
  assert.notEqual(run('tools/archive/archive-crypt.mjs',['decrypt',encrypted,wrong],{PA_ARCHIVE_PASSPHRASE:'a-different-long-and-safe-passphrase'}).status,0);
  assert.equal(fs.existsSync(wrong),false);
});
test('Google Drive uploader refuses plaintext and defaults to dry-run',t=>{
  const dir=temp(t),plain=path.join(dir,'data.jsonl'),cipher=path.join(dir,'data.jsonl.enc');
  fs.writeFileSync(plain,'private');
  fs.writeFileSync(cipher,'encrypted-placeholder');
  assert.notEqual(run('tools/archive/upload-drive.mjs',['--file',plain,'--folder-id','id']).status,0);
  const check=run('tools/archive/upload-drive.mjs',['--file',cipher,'--folder-id','id']);
  assert.equal(check.status,0,check.stderr);
  assert.equal(JSON.parse(check.stdout).uploaded,false);
});
