import fs from 'node:fs';
const edits=new Map();
function edit(file,oldValue,newValue){const value=edits.get(file)??fs.readFileSync(file,'utf8');if(!value.includes(oldValue))throw Error('Missing integration target '+file);edits.set(file,value.replace(oldValue,newValue));}
edit('src/app.js','updateAppStart(state.currentStreamer,roomContextHref());','updateAppStart(state.currentStreamer,roomContextHref(),{enabled:!demo,prepareSource:source=>appInstall.prepareSource(source)});');
edit('src/lobby-entry.js',"updateAppStart(null,new URL('lobby.html',mountUrl).href);","updateAppStart(null,new URL('lobby.html',mountUrl).href,{source:{v:1,kind:'hall',spaceId:scope.spaceId,streamerId:null},name:scope.name,spaceName:scope.name});");
edit('src/public-route-location.js',"'index.html'","'app.html','index.html'");
edit('build.mjs',"['src/public-route-location.js'","['src/pwa-start.js','src/pwa-start-ui.js','src/pwa-install-source.js','src/pwa-launcher.js','src/public-route-location.js'");
edit('build.mjs',"['404.html','sw.js'","['app.html','404.html','sw.js'");
for(const file of ['index.html','src/app.js','src/lobby-entry.js']){const source=edits.get(file)??fs.readFileSync(file,'utf8');edits.set(file,source.replaceAll('10.19-PWA.1','10.20-PWA.1').replaceAll('10.19-PWA.2','10.20-PWA.1'));}
edit('index.html',"if(plan){if(plan.portal)history.replaceState(history.state,'',plan.target);else location.replace(plan.target);}","if(plan){document.documentElement.style.visibility='hidden';location.replace(plan.target);}");
for(const [file,value] of edits)fs.writeFileSync(file,value);
console.log('Integrated install source and APP home settings; no deployment.');
