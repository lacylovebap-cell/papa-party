import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('updated release modules use the same cache version as the entry page',()=>{
 const version=JSON.parse(fs.readFileSync('release.json','utf8')).version;
 for(const page of ['index.html','preview.html']){
  const html=fs.readFileSync(page,'utf8');
  for(const asset of ['src/app.js','src/style.css','src/mobile.css'])assert.ok(html.includes(asset+'?v='+version),page+' must refresh '+asset);
 }
 const app=fs.readFileSync('src/app.js','utf8');
 for(const module of ['catalog-tools','chat','notifications','core'])assert.ok(app.includes('./'+module+'.js?v='+version),module+' must refresh with the entry page');
 assert.ok(fs.readFileSync('src/notifications.js','utf8').includes('./notification-rules.js?v='+version));
 const lobby=fs.readFileSync('lobby.html','utf8'),entry=fs.readFileSync('src/lobby-entry.js','utf8');
 for(const asset of ['src/lobby-entry.js','src/style.css','src/theme.css','src/lobby.css'])assert.ok(lobby.includes(asset+'?v='+version),'lobby must refresh '+asset);
 for(const module of ['config','public-lobby'])assert.ok(entry.includes('./'+module+'.js?v='+version),'lobby must refresh '+module);
});
