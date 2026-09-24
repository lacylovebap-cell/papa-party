import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/,'$1'));
const out=path.join(root,'dist');fs.mkdirSync(out,{recursive:true});
for(const name of ['src/app.js','src/core.js','src/config.js','src/notifications.js','src/notification-rules.js','sw.js'])execFileSync(process.execPath,['--check',path.join(root,name)]);
for(const folder of ['src','assets'])fs.cpSync(path.join(root,folder),path.join(out,folder),{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const file of ['index.html','preview.html','v2.html'])fs.writeFileSync(path.join(out,file),html);
fs.writeFileSync(path.join(out,'release.json'),JSON.stringify({version:'9.24-B',builtAt:new Date().toISOString()}));
console.log('Build 9.24-B complete: static site in dist');

for(const file of ['sw.js','manifest.webmanifest'])fs.copyFileSync(path.join(root,file),path.join(out,file));
