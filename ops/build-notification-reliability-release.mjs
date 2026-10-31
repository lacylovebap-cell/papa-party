import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const baseline=fs.readFileSync('ops/edge-release/party-api-10.31-THEME.1.js','utf8');
const source=fs.readFileSync('supabase/functions/party-api/index.ts','utf8');
const a=baseline.indexOf('async function notificationOperation('),b=baseline.indexOf('async function signalNotices(');
const x=source.indexOf('async function notificationOperation('),y=source.indexOf('async function signalNotices(');
if([a,b,x,y].some(n=>n<0))throw Error('missing boundaries');
const rules=fs.readFileSync('src/notification-rules.js','utf8');
const helper=rules.slice(rules.indexOf('export function noticePushWindow(')).replace('export ','');
let output=baseline.slice(0,a)+helper+'\n'+stripTypeScriptTypes(source.slice(x,y))+'\n'+baseline.slice(b);
if(output.split('"notifications", "noticeTest"').length!==2)throw Error('dispatch boundary');
output=output.replace('"notifications", "noticeTest"','"notifications", "noticeDelta", "noticeTest"').replace('version: "10.31-THEME.1",','version: "10.31-NOTICE.1", notificationReliability: 1,');
fs.writeFileSync('ops/edge-release/party-api-10.31-NOTICE.1.js',output);
for(const file of ['src/app.js','src/notifications.js']){
 let s=fs.readFileSync(file,'utf8');s=s.replace(/(notifications|notification-rules)\.js\?v=[^']+/g,'$1.js?v=10.31-NOTICE.1');fs.writeFileSync(file,s);
}
for(const file of ['v2.html','preview.html']){let s=fs.readFileSync(file,'utf8');s=s.replace(/src\/app\.js\?v=[^&"]+/g,'src/app.js?v=10.31-NOTICE.1');fs.writeFileSync(file,s);}
for(const file of ['build.mjs','supabase/functions/party-api/index.ts']){let s=fs.readFileSync(file,'utf8').replaceAll('10.31-THEME.1','10.31-NOTICE.1');fs.writeFileSync(file,s);}
fs.writeFileSync('release.json',JSON.stringify({version:'10.31-NOTICE.1',backendVersion:'10.31-NOTICE.1',builtAt:new Date().toISOString()}));
