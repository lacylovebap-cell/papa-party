import {createServer} from 'node:http';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const app=fs.readFileSync('src/app.js','utf8');
const part=(start,end)=>{const from=app.indexOf(start),to=app.indexOf(end,from);assert.ok(from>=0&&to>from,start);return app.slice(from,to);};
const functions=[part('function modal(','function paginate('),part('function shortSongOptions(','function crownHelp('),part('function onBehalf(','function installProxyNewButton('),part('function select(name,','document.addEventListener(\'submit\''),app.split(/\r?\n/).find(line=>line.startsWith('function addAllocationRow(')),app.split(/\r?\n/).find(line=>line.startsWith('function drawForStreamer(')),part('async function requestSelectedFavorites(','function crossIdentity()')].join('\n');
const server=createServer((req,res)=>{const name=req.url.split('?')[0].slice(1);if(/^src\/[a-z-]+\.js$/.test(name)){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(name));}else res.end('<!doctype html><html><body><dialog id="dialog"></dialog></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async functions=>{
  const core=await import('/src/core.js'),fate=await import('/src/fate.js'),venue=await import('/src/venue-policy.js');Object.assign(window,core,fate,venue);
  const at='2026-10-21T04:00:00Z',run=(s,type,data)=>core.mutate(s,{type,data},{role:'admin'},at);
  let s=run(core.empty(),'player',{name:'Fixture',balance:20});s=run(s,'settings',{livePrice:1200,liveDouble:300,hourlyLimit:20});
  for(const [title,cost,hidden] of [['Half',.5,false],['Pair',.5,false],['Hidden two',2,true]])s=run(s,'song',{title,artist:'Singer',creditCost:cost,hidden});
  s=core.scopeState(run(s,'song',{...s.songs[0],shortMode:'both',pairSongIds:[s.songs[1].songId]}),'papa');
  Object.assign(window,{state:s,session:{playerId:s.players[0].playerId},selectedFavorites:new Set([s.songs[0].songId]),selectedFavoriteRows:new Map(),favoriteSelectionIdentity:'fixture',favoritesIdentity:()=> 'fixture',streamerSlug:'papa',song:id=>state.songs.find(x=>x.songId===id),clock:()=>at,isoInput:value=>value?new Date(value).toISOString():at,$:q=>document.querySelector(q),h:x=>String(x).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),money:String,isAdmin:()=>true,playerOptions:()=>[['','請選玩家'],...state.players.map(p=>[p.playerId,p.name])],venueSelector:()=>'<select name="venue"><option value="shengma">聲瑪</option></select>',button:(text,act,id='',cls='',extra='')=>'<button type="button" data-act="'+act+'" data-id="'+id+'" '+extra+'>'+text+'</button>',drawnStreamerSong:null,toast:()=>{},say:()=>'',dispatchCalls:[],apiCalls:[],dispatch:async(type,data)=>{dispatchCalls.push({type,data});},api:async body=>{apiCalls.push(body);throw Error('Unexpected request');},demo:false});
  window.eval(functions+'\nwindow.openProxy=onBehalf;window.openAllocation=()=>{modal("Allocation",select("playerId","玩家",playerOptions(),state.players[0].playerId)+"<div id=allocation-rows></div>");addAllocationRow();};window.openSingle=()=>requestSong(state.songs[0].songId,"live");window.openFavorite=()=>requestSelectedFavorites("live");');
  window.pickEntity=(kind,id)=>{const box=document.querySelector('.entity-picker[data-entity-kind="'+kind+'"]'),record=kind==='playerId'?state.players.find(p=>p.playerId===id):song(id);box.querySelector('[type=hidden]').value=id;box.querySelector('[data-entity-query]').value=kind==='playerId'?record.name:record.title;box.querySelector('.entity-results').innerHTML='';box.querySelector('[type=hidden]').dispatchEvent(new Event('change',{bubbles:true}));};
  window.searchEntity=(kind,query)=>{const box=document.querySelector('.entity-picker[data-entity-kind="'+kind+'"]');box.querySelector('[data-entity-query]').value=query;showEntityResults(box);};
 },functions);
 const ids=await page.evaluate(()=>({player:state.players[0].playerId,half:state.songs[0].songId,pair:state.songs[1].songId,hidden:state.songs[2].songId}));
 await page.evaluate(()=>openProxy());
 await page.evaluate(({player,half})=>{pickEntity('playerId',player);pickEntity('songId',half);},ids);
 assert.match(await page.locator('#proxy-cost-summary').textContent(),/扣 0.5 首/);assert.match(await page.locator('#proxy-credits').textContent(),/本次占 0.5 首/);
 await page.locator('[name=pairSongId]').selectOption(ids.half);assert.match(await page.locator('#proxy-cost-summary').textContent(),/扣 1 首/);assert.match(await page.locator('#proxy-credits').textContent(),/本次占 1 首/);
 await page.locator('[name=pairSongId]').selectOption(ids.pair);assert.match(await page.locator('#proxy-cost-summary').textContent(),/扣 1 首/);
 await page.evaluate(()=>searchEntity('songId','Hidden'));assert.match(await page.locator('.entity-picker[data-entity-kind=songId] .entity-results').textContent(),/Hidden two/);
 await page.evaluate(id=>pickEntity('songId',id),ids.hidden);assert.match(await page.locator('#proxy-cost-summary').textContent(),/扣 2 首/);
 await page.locator('[name=kind][value=live]').check();await page.locator('[type=submit]').click();
 assert.equal(await page.evaluate(()=>dispatchCalls[0]?.data.songId),ids.hidden,await page.locator('#dialog-error').textContent());
 // Exercise the actual management draw helper: hidden songs never enter the draw result.
 await page.evaluate(()=>{openProxy();for(let n=0;n<30;n++){drawForStreamer();if(song(document.querySelector('[name=songId]').value)?.hidden)throw Error('Hidden song was drawn');}});
 await page.evaluate(()=>{openAllocation();});
 await page.evaluate(id=>pickEntity('songId',id),ids.half);assert.match(await page.locator('.allocation-cost-summary').textContent(),/0.5 首/);
 await page.locator('[name=pairSongId]').selectOption(ids.half);assert.match(await page.locator('.allocation-cost-summary').textContent(),/1 首/);
 await page.locator('[name=pairSongId]').selectOption(ids.pair);assert.match(await page.locator('.allocation-cost-summary').textContent(),/1 首/);
 // A background refresh updates live state while preserving the open confirmation dialog.
 await page.evaluate(()=>openSingle());await page.locator('[name=gift]').check();
 await page.evaluate(()=>{state.revision++;state.settings.livePrice=5000;state.streamerSettings.papa.livePrice=5000;});
 const beforeDispatch=await page.evaluate(()=>dispatchCalls.length);await page.locator('[type=submit]').click();
 assert.match(await page.locator('#dialog-error').textContent(),/價格已更新.*重新開啟/);assert.equal(await page.evaluate(()=>dispatchCalls.length),beforeDispatch);
 await page.evaluate(()=>openFavorite());await page.locator('[name=gift]').check();await page.evaluate(()=>{state.revision++;state.settings.livePrice=6000;});await page.locator('[type=submit]').click();
 assert.match(await page.locator('#dialog-error').textContent(),/價格已更新.*重新開啟/);assert.equal(await page.evaluate(()=>apiCalls.length),0);
 console.log('Admin pricing UI passed: half/repeat/pair, hidden manual selection, 30 hidden-free draws, allocation change updates, single/favorite stale-price submission blocking');
}finally{await browser.close();server.close();}
