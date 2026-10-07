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
});
