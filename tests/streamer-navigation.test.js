import test from 'node:test';import assert from 'node:assert/strict';
import {streamerDestination,streamerText} from '../src/streamer-navigation.js';
import {empty,mutate,scopeState,requestFees,TIERS} from '../src/core.js';
test('switch keeps the same public page and player credit tab, unknown routes fall back',()=>{
 for(const route of ['home','book','center','gallery']){const u=new URL(streamerDestination('https://example.com/papa-party/?streamer=papa#'+route,'michelle',{subtab:'ledger'}));assert.equal(u.hash,'#'+route);assert.equal(u.searchParams.get('streamer'),'michelle');assert.equal(u.searchParams.get('tab'),route==='center'?'ledger':null);}
 assert.equal(new URL(streamerDestination('https://example.com/#missing','michelle')).hash,'#home');
});
test('streamer cannot navigate into another management room; super admin keeps section',()=>{
 const u=new URL(streamerDestination('https://example.com/?streamer=papa&player=P1#admin','michelle',{role:'streamer_admin',managedSlug:'papa',adminTab:'queue'}));assert.equal(u.hash,'#home');assert.equal(u.searchParams.has('player'),false);
 const superUrl=new URL(streamerDestination('https://example.com/?streamer=papa#admin','michelle',{role:'super_admin',adminTab:'queue'}));assert.equal(superUrl.hash,'#admin');assert.equal(superUrl.searchParams.get('adminTab'),'queue');
});
test('template names use current streamer including old default manual; brand remains stable',()=>{
 assert.equal(streamerText('PA Party｜怕怕／帕帕／{streamer}',{display_name:'米雪'}),'PA Party｜米雪／米雪／米雪');
 assert.equal(streamerText('{streamer}',{display_name:'$&主播'}),'$&主播');
});
test('every crown tier uses ordinary request double fee, preserving card-opening fee',()=>{
 const s=empty();for(const tier of TIERS){const crown={...tier,playerId:'owner',double:18188};assert.deepEqual(requestFees(s,crown,'guest'),{price:tier.price,double:500});assert.deepEqual(requestFees(s,crown,'owner'),{price:2990,double:500});assert.equal(crown.double,18188);}
 assert.deepEqual(requestFees(s,null,'guest'),{price:2990,double:500});
});
test('new streamer has independent empty business data and a usable template',()=>{
 const s=mutate(empty(),{type:'streamer',data:{slug:'michelle',display_name:'米雪'}},{role:'admin'});const r=scopeState(s,'michelle');assert.equal(r.currentStreamer.home_title,'米雪');assert.equal(r.songs.length,0);assert.equal(r.settings.liveDouble,500);assert.match(streamerText(r.settings.manual,r.currentStreamer),/等米雪確認/);assert.ok(!JSON.stringify(s).includes('password_hash'));
});
