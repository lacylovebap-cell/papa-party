import test from 'node:test';import assert from 'node:assert/strict';
import {boardActor,boardModerator,boardCanChange,boardVisible,boardThreadVisible,boardProjection,boardAudience,boardContent,boardUuid} from '../src/board-policy.js';
const player=id=>boardActor({role:'player',playerId:id}),host=id=>boardActor({role:'streamer_admin',streamer_id:id}),supervisor=boardActor({role:'super_admin'});
const post={id:'bd310611-7792-45f6-810f-1ea9bd75a014',seq:1,root_id:null,scope:'streamer',streamer_id:'papa',author_key:'player:A',visibility:'public',targets:[],body:'Hello',anonymous:true,version:1,deleted:false};
test('board requires server-authenticated identities',()=>{for(const a of [null,{}, {role:'player'},{role:'guest'}])assert.throws(()=>boardActor(a));assert.equal(player('A').key,'player:A');assert.equal(host('papa').key,'streamer:papa');assert.equal(boardActor({role:'admin'}).role,'super');});
test('visibility matrix: public, include, exclude, streamers and management',()=>{
 const actors=[player('A'),player('B'),player('C'),host('papa'),host('michelle'),supervisor];
 for(const [visibility,expected] of [['public',[true,true,true,true,true,true]],['include',[true,true,false,true,false,true]],['exclude',[true,false,true,true,true,true]],['streamers',[true,false,false,true,true,true]]]){
  const p={...post,visibility,targets:['player:B']};assert.deepEqual(actors.map(a=>boardVisible(a,p)),expected,visibility);
 }
});
test('global board does not grant a streamer global moderation or anonymous access',()=>{const p={...post,scope:'global',streamer_id:'__global__',visibility:'include',targets:[]};assert.equal(boardModerator(host('papa'),p),false);assert.equal(boardVisible(host('papa'),p),false);assert.equal(boardVisible(supervisor,p),true);});
test('excluded moderators keep scoped management; other hosts cannot reveal identities',()=>{const p={...post,visibility:'exclude',targets:['streamer:papa','super']};assert.equal(boardVisible(host('papa'),p),true);assert.equal(boardVisible(supervisor,p),true);assert.equal(boardModerator(host('michelle'),p),false);});
test('blocks hide identified authors and cannot strip management or self visibility',()=>{const blocks=['player:A'],identified={...post,anonymous:false};assert.equal(boardVisible(player('B'),identified,blocks),false);assert.equal(boardVisible(player('A'),identified,blocks),true);assert.equal(boardVisible(host('papa'),identified,blocks),true);assert.equal(boardVisible(host('michelle'),identified,blocks),false);});
test('reply cannot widen root audience even when reader authored the reply',()=>{const root={...post,anonymous:false,visibility:'include',targets:['player:B']},reply={...post,root_id:post.id,author_key:'player:C'};assert.equal(boardThreadVisible(player('C'),reply,root),false);assert.equal(boardThreadVisible(player('B'),reply,root),true);assert.equal(boardThreadVisible(player('B'),reply,root,['player:A']),false);});
test('player who writes a streamer-only post can read its management replies',()=>{const root={...post,visibility:'streamers'},reply={...root,anonymous:false,root_id:post.id,author_key:'streamer:papa'};assert.equal(boardThreadVisible(player('A'),reply,root),true);assert.equal(boardThreadVisible(player('B'),reply,root),false);assert.equal(boardThreadVisible(player('A'),reply,root,['streamer:papa']),false);});
test('blocking a known account cannot identify its anonymous posts or replies',()=>{const reader=player('B'),root={...post,author_key:'player:B'},reply={...post,root_id:root.id};assert.equal(boardVisible(reader,post,['player:A']),boardVisible(reader,post,[]));assert.equal(boardThreadVisible(reader,reply,root,['player:A']),boardThreadVisible(reader,reply,root,[]));assert.equal(boardVisible(reader,{...post,visibility:'exclude',targets:['player:B']},['player:A']),false);});
test('anonymous API projection has no author keys, targets or private fields',()=>{for(const a of [player('A'),player('B'),host('michelle')]){const v=boardProjection(a,{...post,targets:['player:SECRET'],client_id:'secret',origin_room:'secret'},'Alice');assert.equal(v.author,'匿名使用者');assert.equal(v.managedAuthor,undefined);assert.ok(!JSON.stringify(v).includes('Alice'));for(const k of ['author_key','targets','client_id','origin_room'])assert.ok(!(k in v));}assert.equal(boardProjection(host('papa'),post,'Alice').managedAuthor,'Alice');assert.equal(boardProjection(supervisor,post,'Alice').managedAuthor,'Alice');});
test('removed content redacted for every role, original history not projected',()=>{for(const a of [player('A'),player('B'),host('papa'),supervisor])assert.equal(boardProjection(a,{...post,deleted:true},'Alice').body,'');});
test('authors cannot undo moderator removal and projections do not offer changes',()=>{
 const removed={...post,deleted:true,moderated:true};
 for(const operation of ['edit','remove','restore'])assert.equal(boardCanChange(player('A'),removed,operation),false,operation);
 const projected=boardProjection(player('A'),removed,'Alice');assert.equal(projected.canEdit,false);assert.equal(projected.canManage,false);assert.equal(projected.moderated,true);
});
test('authors can restore their own removals but cannot edit removed content',()=>{
 for(const moderated of [false,undefined]){
  const removed={...post,deleted:true,moderated};assert.equal(boardCanChange(player('A'),removed,'restore'),true);assert.equal(boardCanChange(player('A'),removed,'edit'),false);
  const projected=boardProjection(player('A'),removed,'Alice');assert.equal(projected.canEdit,false);assert.equal(projected.canManage,true);assert.equal(projected.moderated,false);
 }
 assert.equal(boardCanChange(player('A'),post,'edit'),true);assert.equal(boardCanChange(player('B'),post,'remove'),false);assert.equal(boardCanChange(player('A'),post,'unknown'),false);assert.equal(boardCanChange(player('A'),null,'restore'),false);
});
test('only the owning board moderator or super admin can restore moderated content',()=>{
 const removed={...post,deleted:true,moderated:true};
 for(const actor of [player('B'),host('michelle')]){assert.equal(boardCanChange(actor,removed,'restore'),false);assert.equal(boardProjection(actor,removed,'Alice').canManage,false);}
 for(const actor of [host('papa'),supervisor]){assert.equal(boardCanChange(actor,removed,'restore'),true);assert.equal(boardCanChange(actor,removed,'remove'),true);assert.equal(boardCanChange(actor,removed,'edit'),false);assert.equal(boardProjection(actor,removed,'Alice').canManage,true);}
 const global={...removed,scope:'global',streamer_id:'__global__'};assert.equal(boardCanChange(host('papa'),global,'restore'),false);assert.equal(boardCanChange(supervisor,global,'restore'),true);
});
test('audience validation rejects malformed entries and empties unused lists',()=>{assert.throws(()=>boardAudience('include',[]));assert.throws(()=>boardAudience('public',['admin:any']));assert.throws(()=>boardAudience('typo',[]));assert.throws(()=>boardAudience('include',Array(51).fill('player:A')));assert.deepEqual(boardAudience('include',['player:A','player:A','streamer:papa']).targets,['player:A','streamer:papa']);assert.deepEqual(boardAudience('public',['player:A']).targets,[]);});
test('post input limits and stable request IDs',()=>{assert.equal(boardContent(' hi '),'hi');for(const body of ['',null,' '.repeat(20),'a'.repeat(2001)])assert.throws(()=>boardContent(body));assert.equal(boardUuid(post.id),post.id);assert.throws(()=>boardUuid('1&select=*'));});
