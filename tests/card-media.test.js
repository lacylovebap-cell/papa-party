import test from 'node:test';import assert from 'node:assert/strict';
import {cardMediaInput,cardDisplay,orderedCards,validCardUpload} from '../src/card-media.js';
import {empty,mutate,scopeState} from '../src/core.js';import {stateChanges} from '../src/state-patch.js';
const admin={role:'admin'},run=(s,type,data,streamer='papa',actor=admin)=>mutate(s,{type,data,streamer},actor,'2026-10-14T10:00:00Z');
test('card defaults preserve existing display; invalid fields, media and credential URLs reject',()=>{
 assert.deepEqual(cardDisplay({}),{description:true,time:true,player:false,id:false});
 const valid={url:'https://example.com/card.mp4',mediaType:'video',displayFields:{player:true,time:false}};
 assert.equal(cardMediaInput(valid).mediaType,'video');assert.equal(cardMediaInput(valid).displayFields.time,false);
 for(const patch of [{url:'javascript:alert(1)'},{url:'https://user:password@example.com/image'},{mediaType:'html'},{displayFields:{id:'true'}},{displayFields:{password:true}}])assert.throws(()=>cardMediaInput({...valid,...patch}));
});
test('reordering only changes the two selected Room cards, preserves IDs, media, original creation and all accounting',()=>{
 let s=run(empty(),'player',{name:'owner',balance:3});s=run(s,'streamer',{slug:'other',display_name:'Other'});
 for(const room of ['papa','other'])for(let i=0;i<3;i++)s=run(s,'card',{url:'https://example.com/'+room+i+'.webp',startsAt:'2026-10-14T09:00:00Z',description:room+i},room);
 // Formal reads carry the persisted order; Core's in-memory fixture must
 // retain it too, otherwise a global array reconstruction is a false delta.
 s.cards.forEach((c,i)=>c._order=i);
 const before=structuredClone(s),cards=scopeState(s,'papa').cards;
 s=run(s,'card',{id:cards[1].id,operation:'move',direction:-1});
 assert.equal(orderedCards(scopeState(s,'papa').cards)[0].id,cards[1].id);
 assert.deepEqual(s.cards.filter(c=>c.streamer_id==='other'),before.cards.filter(c=>c.streamer_id==='other'));
 for(const key of ['songs','players','ledger','queue','crowns'])assert.deepEqual(s[key],before[key]);
 const patch=stateChanges(scopeState(before,'papa'),scopeState(s,'papa'),{preserveOrder:true});assert.equal(patch.changes.filter(c=>c.kind==='cards').length,2);assert.ok(patch.changes.every(c=>c.kind==='cards'));
 assert.throws(()=>run(s,'card',{id:before.cards.find(c=>c.streamer_id==='other').id,operation:'move',direction:-1}));
 assert.throws(()=>run(s,'card',{id:cards[0].id,operation:'move',direction:1},'papa',{role:'player'}));
});
test('video upload validates MIME, magic and size before storing; arbitrary HTML is never accepted',()=>{
 const mp4=new Uint8Array([0,0,0,20,102,116,121,112,105,115,111,109]);assert.equal(validCardUpload(mp4,'video/mp4'),true);assert.equal(validCardUpload(mp4,'video/webm'),false);
 assert.equal(validCardUpload(new Uint8Array([0x1a,0x45,0xdf,0xa3]),'video/webm'),true);
 assert.equal(validCardUpload(new TextEncoder().encode('<html>'),'video/mp4'),false);assert.equal(validCardUpload(new Uint8Array(20*1024*1024+1),'video/webm'),false);
 assert.equal(validCardUpload(mp4,'text/html'),false);
});
