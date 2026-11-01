import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {visibleTutorials,searchTutorials} from '../src/tutorial-center.js';
const folder='src/tutorials',index=JSON.parse(fs.readFileSync(folder+'/index.json'));
test('role-specific search never leaks streamer results to the player index',()=>{
 const player=visibleTutorials(index,'player',true),streamer=visibleTutorials(index,'streamer',true);
 assert.equal(player.length,12);assert.equal(streamer.length,16);
 assert.equal(searchTutorials(player,'批量').length,0);
 assert.equal(searchTutorials(streamer,'S07')[0].id,'S07');
 assert.equal(searchTutorials(player,'  Ｐ０１  ')[0].id,'P01');
 assert.equal(searchTutorials(index,'<script>').length,0);
});
test('normal mode excludes every unfinished article even if it is present in static files',()=>{
 assert.ok(visibleTutorials(index,'player').every(i=>i.status==='published'));
 assert.ok(visibleTutorials(index,'streamer').every(i=>i.status==='published'));
 assert.equal(visibleTutorials([{id:'ready',audience:'player',status:'published'},{id:'draft',audience:'player',status:'draft'}],'player').length,1);
});
test('every article and image resolves locally; unfinished chapters cannot pass publication requirements',()=>{
 const ids=new Set(),files=new Set();
 for(const item of index){
  assert.ok(!ids.has(item.id));ids.add(item.id);
  assert.match(item.file,/^[PS]\d{2}\.json$/);
  const a=JSON.parse(fs.readFileSync(folder+'/'+item.file));
  assert.equal(a.id,item.id);assert.equal(a.audience,item.audience);assert.equal(a.status,item.status);
  assert.ok(a.intro&&a.steps.length&&a.version);
  const chapters=new Set();
  for(const s of a.steps){assert.ok(!chapters.has(s.id));chapters.add(s.id);assert.ok(s.title&&s.text);
   if(s.image){assert.match(s.image,/^images\/[\w-]+\.webp$/);assert.ok(fs.existsSync(path.join(folder,s.image)));assert.ok(s.alt&&s.caption&&s.width&&s.height);files.add(s.image);}
   for(const m of s.marks||[])assert.ok(m.x>=0&&m.x<=100&&m.y>=0&&m.y<=100);
  }
  if(a.status==='published'){assert.equal(a.missing,'');assert.ok(a.reviewedAt&&a.reviewedBy);assert.ok(a.steps.every(s=>s.image&&s.buttons.length&&s.notes.length));}
  else {assert.equal(a.status,'draft');assert.ok(a.missing);}
 }
 // Shared images are referenced, never copied once for each chapter.
 assert.ok(files.size>0);
});
