import {createServer} from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const app=fs.readFileSync('src/app.js','utf8');
const functions=app.slice(app.indexOf('async function requestSelectedFavorites('),app.indexOf('function crossIdentity()'));
const server=createServer((req,res)=>{const name=req.url.split('?')[0].slice(1);if(/^src\/[a-z-]+\.js$/.test(name)){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(name));}else res.end('<html><body><dialog id="dialog"></dialog></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async functions=>{
  const core=await import('/src/core.js');Object.assign(window,core);
  const at='2026-10-21T04:00:00Z',run=(s,type,data)=>core.mutate(s,{type,data},{role:'admin'},at);
  let s=run(core.empty(),'player',{name:'Fixture',balance:20});s=run(s,'settings',{livePrice:1200,liveDouble:300,hourlyLimit:20});
  for(const [title,cost] of [['Half',.5],['Pair',.5],['Two',2]])s=run(s,'song',{title,artist:'Singer',creditCost:cost});
  s=run(s,'song',{...s.songs[0],shortMode:'both',pairSongIds:[s.songs[1].songId]});
  Object.assign(window,{state:s,session:{playerId:s.players[0].playerId},selectedFavorites:new Set([s.songs[0].songId,s.songs[2].songId]),selectedFavoriteRows:new Map(),favoriteSelectionIdentity:'fixture',favoritesIdentity:()=> 'fixture',song:id=>state.songs.find(x=>x.songId===id),songSelection:x=>({title:x.title,artist:x.artist}),clock:()=>at,$:q=>document.querySelector(q),h:x=>String(x),money:x=>String(x),check:()=>'',modal:(title,body,submit)=>{document.querySelector('#dialog').innerHTML='<form id="modal-form">'+body+'<button type="submit">送出</button></form>';document.querySelector('#modal-form').onsubmit=e=>e.preventDefault();if(!document.querySelector('#dialog').open)document.querySelector('#dialog').showModal();}});
  window.eval(functions);window.openFixture=requestSelectedFavorites;
 },functions);
 await page.evaluate(()=>openFixture('live'));
 assert.match(await page.locator('#favorite-cost-total').textContent(),/3000.*600/);
 await page.locator('[name=favoritePair0]').selectOption({label:'本首唱兩次（1 首）'});
 assert.match(await page.locator('#favorite-cost-total').textContent(),/3600.*600/);
 await page.locator('[name=favoritePair0]').selectOption({label:'搭配 Pair'});
 assert.match(await page.locator('#favorite-cost-total').textContent(),/3600.*600/);
 await page.evaluate(()=>openFixture('saved'));
 assert.match(await page.locator('#favorite-cost-total').textContent(),/2.5 首/);
 await page.locator('[name=favoritePair0]').selectOption({label:'本首唱兩次（1 首）'});
 assert.match(await page.locator('#favorite-cost-total').textContent(),/3 首/);
 assert.equal(await page.locator('[type=submit]').isDisabled(),false);
 await page.evaluate(()=>{state.songs.splice(0,1);document.querySelector('[name=favoritePair0]').dispatchEvent(new Event('change',{bubbles:true}));});
 assert.equal(await page.locator('[type=submit]').isDisabled(),true);
 console.log('Favorites UI: live totals, half/repeat/pair selection, saved totals, stale song blocking passed');
}finally{await browser.close();server.close();}
