import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {THEME_GRADIENTS,THEME_TEMPLATES,themeNormalize,themeValidate,themeCssVariables,themePageLayer,themeGradientFill,themeGradientColors,themeContrast,themeMix} from '../src/theme-engine.js';
import {achievementPanelHtml,createAchievementPanel} from '../src/achievements-view.js';
import {createMedalUnlockTracker} from '../src/medal-animation.js';
const baseline=execFileSync('git',['show','e66e6ce:src/theme-engine.js'],{encoding:'utf8'});
const old=await import('data:text/javascript;base64,'+Buffer.from(baseline).toString('base64'));
test('legacy theme normalization, variables and backgrounds are byte-equivalent; all 30 overlays restore them',()=>{
 assert.equal(THEME_GRADIENTS.length,30);assert.equal(new Set(THEME_GRADIENTS.map(p=>p.id)).size,30);
 for(const preset of THEME_TEMPLATES)for(const mode of ['dark','light']){
  const value={base:preset.base,mode,manual:['logo'],colors:{logo:'#345678'},images:{background:{url:'https://db.example.co/storage/v1/object/public/papa-photos/themes/s/papa/'+ 'a'.repeat(64)+'.webp',opacity:63}},divider:{length:40}};
  const t=themeNormalize(value);assert.deepEqual(t,old.themeNormalize(value));assert.deepEqual(themeCssVariables(t),old.themeCssVariables(t));assert.equal(themePageLayer(t),old.themePageLayer(t));
  for(const gradient of THEME_GRADIENTS){const selected=themeValidate({...t,gradient:gradient.id});assert.equal(selected.gradient,gradient.id);assert.match(themePageLayer(selected),/^linear-gradient/);assert.deepEqual(themeCssVariables(selected),themeCssVariables(t));delete selected.gradient;assert.deepEqual(selected,t);assert.equal(themePageLayer(selected),old.themePageLayer(t));}
 }
 assert.throws(()=>themeValidate({...themeNormalize(),gradient:'url(evil)'}));
});
test('new gradient stops keep default palette text readable in both modes',()=>{
 for(const preset of THEME_TEMPLATES)for(const mode of ['dark','light'])for(const g of THEME_GRADIENTS){const t=themeNormalize({...preset,mode,gradient:g.id});assert.ok(themeGradientFill(t));for(const color of themeGradientColors(t))assert.ok(themeContrast(t.colors.text,color)>=4.5,g.id+mode);}
});
test('replay keeps original emoji and protects locked, hidden, revoked and management catalog',()=>{
 const r={code:'bell',name:'原勳章',emoji:'🛎',qualified:true,visibility:'public'};
 const html=achievementPanelHtml([r]);assert.match(html,/>🛎<\/span>/);assert.doesNotMatch(html,/🛎️/);assert.match(html,/data-medal-replay="bell"/);
 for(const row of [{...r,qualified:false},{...r,revoked:true},{...r,qualified:false,visibility:'hidden'}])assert.doesNotMatch(achievementPanelHtml([row]),/data-medal-replay/);
 assert.doesNotMatch(achievementPanelHtml([r],{manager:true,managementCatalog:true}),/data-medal-replay/);
});
test('unlock detection is scoped, no first-load celebration and no duplicate celebration',()=>{
 const track=createMedalUnlockTracker(),locked=[{code:'a',qualified:false}],earned=[{code:'a',qualified:true}];
 assert.deepEqual(track('p1:room1',locked),[]);assert.deepEqual(track('p1:room1',earned),['a']);assert.deepEqual(track('p1:room1',earned),[]);assert.deepEqual(track('p2:room1',earned),[]);assert.deepEqual(track('p1:room2',earned),[]);
});
test('unlock callback uses existing validated result without additional queries',async()=>{
 let revision=1,qualified=false,calls=0;const events=[];
 const panel=createAchievementPanel({context:()=>({active:true,key:'scope',revision,spaceId:'s',room:'r',playerId:'p'}),api:async()=>{calls++;return {version:1,scope:{spaceId:'s',streamerId:'r',playerId:'p'},rows:[{code:'a',name:'a',qualified}]};},render:()=>{},onUnlocked:codes=>events.push(codes)});
 await panel.load();qualified=true;revision++;await panel.load();await panel.load();assert.equal(calls,2);assert.deepEqual(events,[['a']]);
});

test('gradient persists through existing settings reducer and public projection, with no new operation',async()=>{
 const {empty,upgradePlatform,mutate,scopeState,publicView}=await import('../src/core.js');
 const now='2026-10-29T00:00:00Z',admin={role:'admin'};
 let state=upgradePlatform(empty());
 const theme=themeNormalize({gradient:'violet-dream'});
 state=mutate(state,{type:'settings',streamer:'papa',data:{theme}},admin,now);
 assert.equal(scopeState(state,'papa').settings.theme.gradient,'violet-dream');
 assert.equal(publicView(state,{role:'player',playerId:'P1'},now,'papa').settings.theme.gradient,'violet-dream');
 delete theme.gradient;
 state=mutate(state,{type:'settings',streamer:'papa',data:{theme}},admin,now);
 assert.equal(scopeState(state,'papa').settings.theme.gradient,undefined);
});
