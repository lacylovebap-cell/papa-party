import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('offline deployment export produces a guarded plan without API credentials or source data in reports',t=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'pa-badge-replay-test-'));
 t.after(()=>{const absolute=path.resolve(scratch);assert.ok(absolute.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(absolute,{recursive:true,force:true});});
 const state={spaceId:'space-001',streamerId:'papa',revision:42,asOf:'2026-10-15T20:00:00Z',players:[{playerId:"P'1"}],queue:[],
  ledger:[{id:'receipt',playerId:"P'1",streamer_id:'papa',at:'2026-10-15T12:00:00Z',amount:100,receipt_quantity:100,accounting_kind:'receipt'}]};
 const payload=JSON.stringify({rooms:[state]}),csv='"payload"\r\n"'+payload.replaceAll('"','""')+'"\r\n',input=path.join(scratch,'snapshot.csv');
 fs.writeFileSync(input,csv);
 const result=execFileSync(process.execPath,[new URL('../ops/prepare-badge-replay.mjs',import.meta.url).pathname.replace(/^\/(.:)/,'$1'),input],{cwd:scratch,encoding:'utf8'});
 assert.equal(JSON.parse(result).players,1);assert.doesNotMatch(result,/P'1|receipt/);
 const sql=fs.readFileSync(path.join(scratch,'.badge-replay/replay-plan.sql'),'utf8');
 assert.match(sql,/papa_badge_replay_apply\('space-001','papa',42/);
 assert.match(sql,/P''1/);assert.match(sql,/"id":"P04"/);assert.match(sql,/"id":"S02"/);
 assert.match(sql,/lock_timeout='3s'/);assert.doesNotMatch(sql,/apikey|password|service.role|insert into.*papa_v2_entities/i);
});
