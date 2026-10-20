// Run once after the approved static and Worker releases are live.
// Only public metadata is read. No actor, player, snapshot or mutation is used.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {API,PUBLISHABLE_KEY} from '../src/config.js';
import {encodeInstallSource,decodeInstallSource} from '../src/pwa-install-source.js';

const origin='https://paparty.app',version='10.20-WEB.1',checks=[];
const reportUrl=new URL('./pwa-start-live-verification-20261020.json',import.meta.url);
const source=(kind,streamerId=null)=>({v:1,kind,spaceId:'space-001',streamerId});
const sourceIdentity=value=>({v:1,kind:value.kind,spaceId:value.spaceId,streamerId:value.streamerId});
const publicFields=new Set(['kind','spaceId','streamerId','name','spaceName','streamerSlug','canonicalPath','homePath','active']);
let requests=0;

async function request(url,{method='GET',body=null}={}){
 requests++;
 const response=await fetch(url,{method,redirect:'manual',signal:AbortSignal.timeout(12000),headers:body===null?{'Cache-Control':'no-store'}:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY,'Cache-Control':'no-store'},...(body===null?{}:{body:JSON.stringify(body)})});
 const reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
 if(reader)try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>262144){await reader.cancel();throw Error('Public response exceeded 256 KiB bound');}text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 return {response,text,bytes:size};
}
async function api(body){
 assert.ok(['releaseInfo','publicAppHomes','publicAppHome'].includes(body.op),'only approved read-only public operations');
 const {response,text}=await request(API,{method:'POST',body});assert.equal(response.status,200,body.op+' status');
 assert.match(response.headers.get('content-type')||'',/^application\/json(?:;|$)/i);
 const value=JSON.parse(text);assert.equal(Boolean(value?.error),false,body.op+' error');return value;
}
async function check(name,run){
 try{const details=await run();checks.push({name,passed:true,...details});return details;}
 catch(error){checks.push({name,passed:false,error:String(error?.message||error).slice(0,700)});return null;}
}
function publicRow(row,expected){
 assert.ok(row&&typeof row==='object'&&!Array.isArray(row),'public home row');
 assert.ok(Object.keys(row).every(key=>publicFields.has(key)),'public fields only');
 assert.deepEqual(sourceIdentity(row),expected,'exact stable source');assert.equal(row.active,true);
 assert.ok(typeof row.name==='string'&&row.name.length>0&&typeof row.spaceName==='string'&&row.spaceName.length>0);
 const home=new URL(row.homePath,origin);assert.equal(home.origin,origin);assert.equal(home.username,'');assert.equal(home.password,'');
 if(row.canonicalPath!==null){assert.equal(home.pathname,row.canonicalPath);assert.equal(home.search,'');assert.equal(home.hash,'');}
 return {source:expected,streamerSlug:row.streamerSlug,homePath:row.homePath};
}
async function manifest(expected=null){
 const path='/manifest.webmanifest'+(expected?'?install='+encodeInstallSource(expected):'');
 const {response,text}=await request(origin+path);assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/^application\/(?:manifest\+)?json(?:;|$)/i);
 const value=JSON.parse(text),url=new URL(value.start_url,origin+'/manifest.webmanifest');
 assert.equal(new URL(value.id,origin+'/manifest.webmanifest').href,origin+'/');assert.equal(new URL(value.scope,origin+'/manifest.webmanifest').href,origin+'/');
 assert.equal(url.origin,origin);assert.equal(url.pathname,'/app.html');assert.equal(url.hash,'');
 if(expected){assert.deepEqual([...url.searchParams.keys()],['install']);assert.deepEqual(decodeInstallSource(url.searchParams.get('install')),expected);}
 else assert.equal(url.search,'');
 return {path,status:response.status,id:value.id,scope:value.scope,startUrl:value.start_url,source:expected};
}
function attribute(tag,name){const match=tag.match(new RegExp('\\b'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));return match?.[1]??match?.[2]??match?.[3]??null;}

await check('frontend release',async()=>{const {response,text}=await request(origin+'/release.json');assert.equal(response.status,200);const value=JSON.parse(text);assert.equal(value.version,version);assert.equal(value.backendVersion,version);return {version:value.version,backendVersion:value.backendVersion};});
await check('Edge release and capabilities',async()=>{const value=await api({op:'releaseInfo'});assert.equal(value.version,version);assert.equal(value.publicAppHomes,1);assert.equal(value.nativeApps,false);return {version:value.version,publicAppHomes:value.publicAppHomes,nativeApps:value.nativeApps};});

// One bounded discovery request supplies the authoritative Michelle stable ID.
// No second page, name guessing, full directory or per-player request is made.
let listed=null;
await check('one bounded public home page',async()=>{
 const value=await api({op:'publicAppHomes',q:'',kind:'all',page:1,pageSize:12});
 assert.ok(Array.isArray(value.items)&&value.items.length<=12);assert.equal(value.page,1);assert.equal(value.pageSize,12);assert.ok(Number.isSafeInteger(value.total)&&value.total>=value.items.length);assert.equal(value.totalPages,Math.max(1,Math.ceil(value.total/12)));
 for(const row of value.items)publicRow(row,sourceIdentity(row));listed=value;
 return {page:1,pageSize:12,returned:value.items.length,total:value.total,totalPages:value.totalPages};
});

const targets=[{label:'Papa',value:source('streamer','papa'),slug:'papa'},{label:'hall',value:source('hall'),slug:null}];
await check('Michelle stable identity from public directory',async()=>{
 const matching=listed?.items.filter(row=>row.kind==='streamer'&&row.spaceId==='space-001'&&row.streamerSlug==='michelle')||[];
 assert.equal(matching.length,1,'Michelle must occur once in the single bounded public page');
 const target=sourceIdentity(matching[0]);targets.push({label:'Michelle',value:target,slug:'michelle'});return {source:target,streamerSlug:'michelle'};
});
for(const target of targets)await check(target.label+' exact public homepage',async()=>{const row=await api({op:'publicAppHome',...target.value});const result=publicRow(row,target.value);assert.equal(row.streamerSlug,target.slug);return result;});
await check('generic shared APP manifest',()=>manifest());
for(const target of targets)await check(target.label+' source manifest',()=>manifest(target.value));

await check('APP shell is publicly available',async()=>{const {response,text}=await request(origin+'/app.html');assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/^text\/html(?:;|$)/i);assert.match(text,/<title>PA Party｜APP 首頁<\/title>/);assert.match(text,/data-app-launcher/);assert.match(text,/pwa-launcher\.js\?v=10\.20-PWA\.1/);return {path:'/app.html',status:response.status};});
await check('pretty book HTML contains its initial install source',async()=>{
 const {response,text}=await request(origin+'/pa/book');assert.equal(response.status,200);const links=[...text.matchAll(/<link\b[^>]*>/gi)].filter(match=>attribute(match[0],'rel')?.toLowerCase()==='manifest');assert.equal(links.length,1);
 const href=attribute(links[0][0],'href'),url=new URL(href,origin+'/');assert.equal(url.origin,origin);assert.equal(url.pathname,'/manifest.webmanifest');assert.deepEqual([...url.searchParams.keys()],['install']);assert.deepEqual(decodeInstallSource(url.searchParams.get('install')),source('streamer','papa'));
 assert.ok(links[0].index<text.search(/<script\b/i),'manifest must precede scripts');
 const raw=text.match(/<script\b[^>]*\bid="public-route-data"[^>]*>([^<]*)<\/script>/i)?.[1];assert.ok(raw);const metadata=JSON.parse(raw);assert.equal(metadata.spaceId,'space-001');assert.equal(metadata.streamerId,'papa');assert.equal(metadata.section,'book');
 return {path:'/pa/book',status:response.status,source:source('streamer','papa'),section:'book'};
});
await check('uppercase alias preserves book destination',async()=>{const {response}=await request(origin+'/PA/book');assert.equal(response.status,308);assert.equal(response.headers.get('location'),origin+'/pa/book');return {path:'/PA/book',status:response.status,location:'/pa/book'};});

const result={verifiedAt:new Date().toISOString(),expectedVersion:version,productionMutations:false,businessSnapshotsRead:false,privatePlayerOrAuditDataRead:false,polling:false,requests,checks,passed:checks.filter(value=>value.passed).length,failed:checks.filter(value=>!value.passed).length};
result.allPassed=result.failed===0&&targets.length===3;
await writeFile(reportUrl,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({allPassed:result.allPassed,passed:result.passed,failed:result.failed,requests,report:reportUrl.pathname}));
if(!result.allPassed)process.exitCode=1;
