import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ENTRY_CATEGORIES,portalChoices,portalEntryDestination,portalDestinations,mountPortalEntryPicker} from '../src/portal-entry-picker.js';
import {lobbyLocation,lobbyQuery,lobbyRoomDestination} from '../src/public-lobby.js';
test('official entry has the management centre categories, 聲瑪 always, and open Spaces from the server',()=>{
 assert.deepEqual(ENTRY_CATEGORIES.map(x=>x[1]),['廳','獨立主播']);
 assert.deepEqual(portalChoices('hall').map(x=>x.name),['聲瑪']);assert.deepEqual(portalChoices('independent'),[]);
 for(const mode of ['player','admin']){
  const url=new URL(portalEntryDestination('https://paparty.app/?password=secret#admin',{kind:'hall',id:'space-001',mode}));
  assert.equal(url.pathname,'/lobby.html');assert.deepEqual([...url.searchParams],[['portalLogin',mode]]);assert.equal(url.hash,'');
 }
 const list=portalDestinations([{id:'space-001',name:'聲瑪',kind:'hall',streamers:[{slug:'papa',name:'怕怕'}]},
  {id:'space-479',name:'仙女',kind:'independent',streamers:[{slug:'fairy',name:'仙女'}]},
  {id:'space-9',name:'星光廳',kind:'hall',streamers:[{slug:'star',name:'星星'},{slug:'moon',name:'月月'}]},
  {id:'space-x',name:'壞資料',kind:'other',streamers:[{slug:'x'}]},{id:'space-y',name:'沒有主播',kind:'hall',streamers:[]},{id:'../evil',name:'壞',kind:'hall',streamers:[{slug:'a'}]}]);
 assert.deepEqual(portalChoices('hall',list).map(x=>x.name),['聲瑪','星光廳']);
 assert.deepEqual(portalChoices('independent',list).map(x=>x.name),['仙女']);
 const fairy=new URL(portalEntryDestination('https://paparty.app/',{kind:'independent',id:'space-479',mode:'admin'},list));
 assert.equal(fairy.pathname,'/v2.html');assert.deepEqual([...fairy.searchParams],[['streamer','fairy'],['portalLogin','admin']]);
 assert.equal(new URL(portalEntryDestination('https://paparty.app/',{kind:'hall',id:'space-9',mode:'player'},list)).searchParams.get('streamer'),'star');
 assert.deepEqual(portalDestinations(null).map(x=>x.id),['space-001'],'聲瑪 stays even if the list is missing');
 for(const x of [{kind:'hall',id:'other',mode:'admin'},{kind:'independent',id:'space-001',mode:'player'},{kind:'hall',id:'space-001',mode:'super_admin'}])assert.throws(()=>portalEntryDestination('https://paparty.app/',x,list));
});
test('valid login intent survives hall search, pagination and room selection without extra auth fields',()=>{
 for(const mode of ['player','admin']){
  const base='https://paparty.app/lobby.html?portalLogin='+mode+'&token=secret&spaceId=other#admin';
  const url=lobbyLocation(base,{...lobbyQuery(base),q:'愛你',page:2});
  assert.equal(new URL(url).searchParams.get('portalLogin'),mode);assert.doesNotMatch(url,/secret|spaceId|#/);
  const room=new URL(lobbyRoomDestination(url,{slug:'papa'}));assert.equal(room.pathname,'/v2.html');assert.equal(room.searchParams.get('portalLogin'),mode);
  const song=new URL(lobbyRoomDestination(url,{slug:'papa'},'s1','live'));assert.equal(song.searchParams.get('commonRequest'),'s1');
 }
 for(const tail of ['?portalLogin=super_admin','?portalLogin=player&portalLogin=admin']){
  const url=lobbyLocation('https://paparty.app/lobby.html'+tail,lobbyQuery('https://paparty.app/lobby.html'));
  assert.equal(new URL(url).searchParams.has('portalLogin'),false);
 }
});
test('only the official homepage mounts category selection; existing login dialogs remain unchanged',()=>{
 const portal=fs.readFileSync('index.html','utf8'),app=fs.readFileSync('src/app.js','utf8');
 assert.equal((portal.match(/data-portal-login=/g)||[]).length,6);assert.match(portal,/portal-login-dialog/);
 for(const page of ['v2.html','preview.html','lobby.html'])assert.doesNotMatch(fs.readFileSync(page,'utf8'),/portal-login-dialog|entryCategory/);
 assert.doesNotMatch(app,/entryCategory|portal-entry-picker/);
 const hall=fs.readFileSync('lobby.html','utf8');assert.match(hall,/<h1>聲瑪大廳<\/h1>/);assert.doesNotMatch(hall,/全站主播大廳|跨主播找歌/);
});
function fixture(){
 const element=()=>({value:'',disabled:false,textContent:'',innerHTML:'',events:{},addEventListener(type,handler){this.events[type]=handler;}});
 const fields=Object.fromEntries(['form','[name=entryCategory]','[name=entryDestination]','[data-entry-hint]','[type=submit]','[data-entry-name-label]','h2','[data-entry-close]'].map(k=>[k,element()]));
 const dialog={open:false,querySelector:s=>fields[s],showModal(){this.open=true;},close(){this.open=false;}},events={},urls=[];
 const document={querySelector:()=>dialog,addEventListener:(name,handler)=>events[name]=handler};
 const picker=mountPortalEntryPicker({document,href:'https://paparty.app/',navigate:url=>urls.push(url),loadDirectory:async()=>[{id:'space-001',name:'聲瑪',kind:'hall',streamers:[{slug:'papa',name:'怕怕'}]},{id:'space-479',name:'仙女',kind:'independent',streamers:[{slug:'fairy',name:'仙女'}]}]});
 const click=mode=>events.click({target:{closest:()=>({dataset:{portalLogin:mode}})},preventDefault(){}});
 return {fields,dialog,urls,click,picker};
}
test('picker resets name when category or role changes, loads open Spaces once, and sends 仙女 to her own login page',async()=>{
 const f=fixture(),category=f.fields['[name=entryCategory]'],destination=f.fields['[name=entryDestination]'],submit=f.fields['[type=submit]'];
 f.click('player');assert.equal(f.dialog.open,true);assert.equal(submit.disabled,true);await f.picker.ready();
 category.value='hall';category.events.change();destination.value='space-001';destination.events.change();assert.equal(submit.disabled,false);
 f.fields.form.events.submit({preventDefault(){}});assert.equal(new URL(f.urls[0]).searchParams.get('portalLogin'),'player');
 category.value='independent';category.events.change();assert.match(destination.innerHTML,/仙女/);destination.value='space-479';destination.events.change();
 f.fields.form.events.submit({preventDefault(){}});const url=new URL(f.urls[1]);assert.equal(url.pathname,'/v2.html');assert.equal(url.searchParams.get('streamer'),'fairy');
 f.click('admin');assert.equal(category.value,'');assert.equal(submit.disabled,true);assert.equal(f.fields.h2.textContent,'管理登入');
 category.value='independent';category.events.change();assert.equal(f.fields['[data-entry-name-label]'].textContent,'主播名稱');
 f.fields['[data-entry-close]'].events.click();assert.equal(f.dialog.open,false);
});
