import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/party-api/index.ts','utf8'));
const start=source.indexOf(" if(b.op==='platformManagementDirectory'){");
const code=source.slice(start,source.indexOf(" if(b.op==='platformManageSpace'){",start));
const Handler=Object.getPrototypeOf(async function(){}).constructor;
const handler=new Handler('b','who','api','respond',code);
test('overview separates active homes, inactive homes, archived entries and login credentials',async()=>{
 const calls=[];
 const api=async(path,body)=>{calls.push({path,body});if(path.endsWith('papa_management_directory'))return {summary:{streamers:12,archivedStreamers:6},rows:[]};if(path.endsWith('papa_streamer_directory'))return Array.from({length:12},(_,i)=>({active:i<5}));if(path.includes('papa_streamer_accounts'))return Array.from({length:6},()=>({enabled:true}));throw Error('unexpected endpoint');};
 const result=await handler({op:'platformManagementDirectory',section:'overview',q:'',page:1},{accountId:'verified'},api,x=>x);
 assert.equal(result.summary.activeStreamers,5);assert.equal(result.summary.inactiveStreamers,1);assert.equal(result.summary.archivedStreamers,6);assert.equal(result.summary.enabledStreamerLogins,6);assert.equal(calls.length,3);
});
test('number labels read only the requested account page and preserve original identity',async()=>{
 const calls=[],rows=[{id:'a',name:'One'},{id:'b',name:'Two'}];
 const api=async(path,body)=>{calls.push({path,body});return path.endsWith('papa_management_directory')?{rows}: {a:'001',b:'002'};};
 const result=await handler({op:'platformManagementDirectory',section:'accounts',q:'Two',page:2},{accountId:'verified'},api,x=>x);
 assert.deepEqual(calls[1].body,{subject:'verified',requested_accounts:['a','b']});assert.equal(result.rows[1].id,'b');assert.equal(result.rows[1].displayNumber,'002');
});
