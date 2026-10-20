import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';

// Run the generated production handler. Only its HTTP boundary is replaced;
// actor(), activity and snapshot helpers stay real and must never be reached.
execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
const bundle=stripTypeScriptTypes(fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8')
 .replace(/^import webpush .*;\r?\n/m,'const webpush={};'));
const source={v:1,kind:'streamer',spaceId:'space-001',streamerId:'papa'};
const row={kind:'streamer',spaceId:'space-001',streamerId:'papa',streamerSlug:'papa',name:'怕怕',spaceName:'聲瑪',
 canonicalPath:'/pa',homePath:'/pa',active:true};
const result=(items=[row],size=12)=>({items,page:1,pageSize:size,total:items.length,totalPages:1});
function fixture({reply,error,network=false}={}){
 let handler;const calls=[],background=[];
 const fetch=async(url,options={})=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;calls.push({path,body,method:options.method});
  assert.equal(path,'/rest/v1/rpc/papa_public_app_homes','no auth, business snapshot, full directory or per-room URL queries');
  if(network)throw Error('network timeout');if(error)return Response.json({error:'temporary'}, {status:503});
  return Response.json(reply===undefined?result([row],body.page_limit):reply);
 };
 const context=vm.createContext({Error,URL,Response,Date,crypto,structuredClone,TextEncoder,Uint8Array,atob,console,fetch,
  EdgeRuntime:{waitUntil:work=>background.push(work)},Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://pwa-homes-fixture.invalid':'fixture-service'},serve:fn=>handler=fn}});
 vm.runInContext(bundle,context);
 const invoke=async body=>{const response=await handler({method:'POST',json:async()=>body});return {status:response.status,body:await response.json()};};
 return {invoke,calls,background};
}

test('actual Edge public home list uses one bounded read before actor, activity or native snapshot guards',async()=>{
 const f=fixture({reply:result([{...row,password:'private',ledger:['private']}],5)}),response=await f.invoke({op:'publicAppHomes',q:' 怕怕 ',kind:'streamer',pageSize:5,
  token:'device:spoof',role:'super_admin',streamer:'native-room',spaceId:'native-space',activityPage:'home',activityVisible:true});
 assert.equal(response.status,200,JSON.stringify(response.body));assert.deepEqual(response.body.items,[row]);assert.equal(f.calls.length,1);assert.equal(f.background.length,0);
 assert.deepEqual(f.calls[0].body,{query_text:'怕怕',requested_kind:'streamer',page_limit:5,page_offset:0,source_space:null,source_room:null,source_kind:null});
 assert.doesNotMatch(JSON.stringify(response.body),/password|private|ledger|token|role/);
});

test('actual Edge exact source lookup passes stable IDs with version and never trusts claimed URL or incidental streamer slug',async()=>{
 const f=fixture(),response=await f.invoke({op:'publicAppHome',...source,name:'米雪',homePath:'https://evil.invalid/',streamer:'other',activityVisible:true,activityPage:'home'});
 assert.equal(response.status,200,JSON.stringify(response.body));assert.deepEqual(response.body,row);assert.equal(f.calls.length,1);assert.equal(f.background.length,0);
 assert.deepEqual(f.calls[0].body,{query_text:'',requested_kind:'streamer',page_limit:1,page_offset:0,source_space:'space-001',source_room:'papa',source_kind:'streamer'});
});

test('actual Edge invalid or missing source, invalid kind and unbounded query are rejected before any database call',async()=>{
 for(const body of [{op:'publicAppHome',...source,v:2},{op:'publicAppHome',...source,streamerId:null},{op:'publicAppHome',...source,spaceId:'bad space'},
  {op:'publicAppHomes',pageSize:13},{op:'publicAppHomes',page:-1},{op:'publicAppHomes',q:'x'.repeat(101)},{op:'publicAppHomes',kind:'account'}]){
  const f=fixture(),response=await f.invoke(body);assert.equal(response.status,400);assert.equal(f.calls.length,0);assert.equal(f.background.length,0);
 }
});

test('actual Edge authoritative empty source is null but upstream/network errors remain failure responses',async()=>{
 const empty=fixture({reply:result([],1)});assert.deepEqual(await empty.invoke({op:'publicAppHome',...source}),{status:200,body:null});assert.equal(empty.calls.length,1);
 for(const options of [{error:true},{network:true}]){
  const f=fixture(options),response=await f.invoke({op:'publicAppHome',...source});assert.equal(response.status,400);assert.equal(typeof response.body.error,'string');assert.equal(f.calls.length,1);assert.equal(f.background.length,0);
 }
});

test('actual Edge rejects cross-scope source rows and non-home destinations instead of navigating to them',async()=>{
 for(const value of [{...row,spaceId:'native-space'},{...row,streamerId:'other'},{...row,homePath:'/pa/admin'},{...row,active:false}]){
  const f=fixture({reply:result([value],1)}),response=await f.invoke({op:'publicAppHome',source});assert.equal(response.status,400);assert.equal(f.calls.length,1);assert.equal(f.background.length,0);
 }
});
