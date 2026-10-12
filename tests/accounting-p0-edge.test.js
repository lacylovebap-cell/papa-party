import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8'),lines=source.split(/\r?\n/);
function take(name){const a=lines.findIndex(x=>x.startsWith('async function '+name+'(')),b=lines.findIndex((x,i)=>i>a&&x==='}');return lines.slice(a,b+1).join('\n');}
const a=source.indexOf(" if(b.op==='accountingSummary'){"),b=source.indexOf(" if(b.op==='mutate'&&!who)",a);
const code=stripTypeScriptTypes(take('accountingSummary')+'\nasync function handle(b,who){'+source.slice(a,b)+'}');
function fixture({role='streamer_admin',invalid=false}={}){
 const calls=[],scope={spaceId:'space-001',id:'verified-room'};
 const ctx=vm.createContext({respond:r=>r,managerRoom:async who=>{if(!['streamer_admin','super_admin'].includes(who?.role))throw Error('manager required');return scope;},
  api:async(path,body)=>{calls.push({path,body});return {scope:{spaceId:scope.spaceId,roomId:invalid?'other-room':scope.id},day:body.requested_day,timezone:'Asia/Taipei',rolloverHour:19,stored:2,received:5,sung:3,saved:2,reserved:1,available:1,revision:10};}});
 vm.runInContext(code,ctx);return {calls,invoke:body=>ctx.handle(body,role?{role}:null)};
}
test('stats request ignores caller Space/Room/player identities and returns only authority aggregates',async()=>{
 const f=fixture(),r=await f.invoke({op:'accountingSummary',streamer:'selected',spaceId:'forged',roomId:'forged',playerId:'victim',day:'2026-10-12'});
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{path:'/rest/v1/rpc/papa_accounting_summary',body:{requested_space:'space-001',requested_room:'verified-room',requested_day:'2026-10-12'}}]);
 assert.equal(r.summary.sung,3);assert.equal(r.summary.available,1);
 assert.equal(JSON.stringify(r).includes('victim'),false);
});
test('anonymous/player requests, invalid dates and cross-scope replies fail closed without fallback',async()=>{
 for(const role of [null,'player']){const f=fixture({role});await assert.rejects(f.invoke({op:'accountingSummary',day:'2026-10-12'}),/manager/);assert.equal(f.calls.length,0);}
 const f=fixture();for(const day of ['',null,'2026-10-12T19:00','12/10/2026'])await assert.rejects(f.invoke({op:'accountingSummary',day}),/日期/);assert.equal(f.calls.length,0);
 const wrong=fixture({invalid:true});await assert.rejects(wrong.invoke({op:'accountingSummary',day:'2026-10-12'}),/摘要範圍/);assert.equal(wrong.calls.length,1);
});
