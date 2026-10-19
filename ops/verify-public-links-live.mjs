// Read-only production smoke check. Never sends player credentials or mutations.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const origin='https://paparty.app',checks=[];
async function check(path,status,{method='GET',headers={},meta=null,location=null}={}){
 const r=await fetch(origin+path,{method,headers,redirect:'manual'});
 assert.equal(r.status,status,path);
 const result={path,method,status:r.status,server:r.headers.get('server')};
 if(location){assert.equal(r.headers.get('location'),origin+location);result.location=location;}
 if(meta){const html=await r.text(),raw=html.match(/<script type="application\/json" id="public-route-data">([^<]*)<\/script>/)?.[1];assert.ok(raw,path+' public metadata');const data=JSON.parse(raw);for(const [key,value] of Object.entries(meta))assert.equal(data[key],value,key);assert.match(html,/<base href="\/">/);result.metadata=meta;}else{await r.arrayBuffer();}
 checks.push(result);
}
await check('/',200);
await check('/sm',200,{meta:{spaceId:'space-001',kind:'hall',canonicalPath:'/sm',streamerId:null}});
await check('/pa/book',200,{meta:{spaceId:'space-001',kind:'streamer',canonicalPath:'/pa',streamerId:'papa',section:'book'}});
await check('/PA/book',308,{location:'/pa/book'});
await check('/pa',200,{method:'HEAD'});
await check('/assets/pa-party-approved.png',206,{headers:{Range:'bytes=0-63'}});
await check('/public-route-not-registered-1019',404);
const release=await (await fetch(origin+'/release.json')).json();assert.equal(release.version,'10.19-WEB.2');
const api=await (await fetch('https://zwhcgqwbtummydapuori.supabase.co/functions/v1/party-api',{method:'POST',headers:{'content-type':'application/json',apikey:'sb_publishable_b6H06pW-dSx9YIlQwAvUng_nS_c2Iqf'},body:JSON.stringify({op:'releaseInfo'})})).json();assert.equal(api.version,'10.19-WEB.2');assert.equal(api.publicLinks,1);assert.equal(api.nativeApps,false);
const result={verifiedAt:new Date().toISOString(),productionMutations:false,release,api:{version:api.version,publicLinks:api.publicLinks,nativeApps:api.nativeApps},checks};
await writeFile(new URL('./public-links-live-verification-20261019.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,version:release.version,allPassed:true}));
