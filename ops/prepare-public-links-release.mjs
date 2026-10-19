import fs from 'node:fs';
const files=['build.mjs','release.json','index.html','v2.html','preview.html','lobby.html','src/app.js','src/lobby-entry.js','src/public-route-bootstrap.js','src/public-route-location.js','src/public-links.js','supabase/functions/party-api/index.ts'];
for(const file of files){let text=fs.readFileSync(file,'utf8');text=text.replaceAll('10.19-WEB.1','10.19-WEB.2');if(['src/app.js','src/lobby-entry.js'].includes(file))text=text.replaceAll('10.19-PWA.1','10.19-PWA.2');if(file==='supabase/functions/party-api/index.ts')text=text.replace("version:'10.19-WEB.2',publicLobby:1","version:'10.19-WEB.2',publicLinks:1,publicLobby:1");fs.writeFileSync(file,text);}
console.log('Prepared 10.19-WEB.2 public links release; no deployment performed.');
