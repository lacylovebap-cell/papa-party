import fs from 'node:fs';
const root=new URL('./',import.meta.url),read=f=>fs.readFileSync(new URL(f,root),'utf8');
const core=read('src/core.js').replace(/^export /gm,''),rules=read('src/notification-rules.js').replace(/^export /gm,''),edge=read('supabase/functions/party-api/index.ts').replace(/^import .*from '\.\.\/.*;\r?\n/gm,'');
const policy=read('src/access-policy.js').replace(/^export /gm,'');const code=core+'\n'+rules+'\n'+policy+'\n'+edge;
fs.writeFileSync(new URL('deploy-function.txt',root),code);
fs.writeFileSync(new URL('deploy-function.html',root),'<meta charset="utf-8"><pre>'+code.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>');
console.log('Notification edge bundle created');
