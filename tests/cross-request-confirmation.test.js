import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const text=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const body=text.slice(text.indexOf('async function confirmCrossRequest('),text.indexOf('async function openCrossRequest('));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const quote={songId:'half',title:'半首',kind:'live',creditCost:1,price:600,double:300,fees:{units:1,singer:600,host:300,hall:300,source:'base',plans:[]}};
async function run({active=true,ok=true,accept=true}={}){
 const calls=[],messages=[],jobs=[{streamer:'other',rows:[{songId:'half',kind:'live'}]}];
 const api=async b=>{calls.push(b);return {results:[{streamer:'other',ok,quotes:[quote],error:ok?undefined:'歌曲未開放'}]};};
 // The room's own party names come from the shared pricing engine (stubbed with 聲瑪 names here).
 const liveFeeText=fees=>'給歌手 '+fees.fees.singer+'＋給2號位主持 '+fees.fees.host+'＋給聲瑪樂團 '+fees.fees.hall+' 探鑽';
 const invoke=new AsyncFunction('api','crossView','money','confirm','liveFeeText',body+';return confirmCrossRequest;');
 const helper=await invoke(api,{selected:new Map([['other',{slug:'other',name:'另一位主播'}]])},String,message=>{messages.push(message);return accept;},liveFeeText);
 return {result:await helper(jobs,()=>active,17),calls,messages,jobs};
}
test('cross confirmation uses target room quote and carries its exact amounts into commit',async()=>{const r=await run();assert.equal(r.result,true);assert.equal(r.calls[0].revision,17);assert.equal(r.calls[0].op,'requestBatchQuote');assert.match(r.messages[0],/另一位主播.*\n半首：給歌手 600＋給2號位主持 300＋給聲瑪樂團 300 探鑽/);assert.deepEqual(r.jobs[0].expectedQuotes,[quote]);});
test('closing or switching context during quote does not show confirmation',async()=>{const r=await run({active:false});assert.equal(r.result,false);assert.equal(r.messages.length,0);});
test('cancelling confirmation sends no mutation and failed quote cannot be confirmed',async()=>{const r=await run({accept:false});assert.equal(r.result,false);assert.equal(r.calls.length,1);await assert.rejects(run({ok:false}),/歌曲未開放/);});
