import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {empty,mutate,publicView,list} from '../src/core.js';
import {fateCategories} from '../src/fate.js';
import {NEW_PRACTICE_TAG,isNewPracticeSong,newPracticeSongTags,newPracticeDate} from '../src/new-practice.js';

const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const lines=app.split(/\r?\n/);
const line=prefix=>{const found=lines.find(value=>value.startsWith(prefix));assert.ok(found,prefix);return found;};
const segment=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const helpers=segment('function songTagVocabulary()','function newPracticeScope()');
const plain=value=>JSON.parse(JSON.stringify(value));
const now='2026-10-10T03:00:00.000Z';
const escape=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const check=(name,label,checked=false)=>'<label><input type="checkbox" name="'+name+'" '+(checked?'checked':'')+'>'+escape(label)+'</label>';
const field=(name,label,value='')=>'<label>'+escape(label)+'<input name="'+name+'" value="'+escape(value)+'"></label>';
class FixtureFormData{
 constructor(form){this.form=form;}
 get(name){const row=this.form.elements[name];return name==='new'&&row?.type==='checkbox'?(row.checked?'on':null):row?.value??'';}
 getAll(name){if(name==='tags')return this.form.tagRows.filter(row=>row.checked).map(row=>row.value);if(name==='pairSongIds')return ['B'];return [];}
 has(name){return name==='new'&&this.form.elements.new.type==='checkbox'?this.form.elements.new.checked:!!this.get(name);}
 set(name,value){this.form.elements[name].value=value;}
}
function formFixture({bulk=false,mode='keep',member=true}={}){
 const elements={new:{name:'new',type:bulk?'select-one':'checkbox',checked:member,value:''},tagMode:{name:'tagMode',value:mode},customTags:{name:'customTags',value:''},cat:{name:'cat',value:''},artistType:{name:'artistType',value:''},creditCost:{name:'creditCost',value:''},murmurMode:{name:'murmurMode',value:'keep'},murmur:{name:'murmur',value:''}};
 const reserved={name:'tags',value:NEW_PRACTICE_TAG,checked:bulk?false:member},ordinary={name:'tags',value:'甜歌',checked:!bulk},listeners=new Map();
 const form={elements,tagRows:[ordinary,reserved],querySelector(selector){if(selector==='[name=new]')return elements.new;if(selector==='[name=customTags]')return elements.customTags;if(selector==='[name=tags][value="新練"]')return reserved;if(selector==='[name=title]')return {closest:()=>({insertAdjacentHTML:()=>{}})};return null;},addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(callback);}};
 return {form,reserved,ordinary,events(type,target){for(const callback of listeners.get(type)||[])callback({target,isComposing:false});}};
}
function harness({bulk=false,mode='keep',member=true,dated=false}={}){
 let full=empty();full.settings.tags=[];full.songs=[
  {songId:'A',title:'Original',artist:'Artist',cat:'華語',artistType:'其他',new:member,tags:member?[]:['甜歌'],...(dated?{newPracticeAt:'2026-09-01T00:00:00.000Z'}:{}),murmur:'',lyrics:'PRIVATE_BODY',privateNotes:'PRIVATE_NOTE',key:'Am',creditCost:0.5,shortMode:'both',pairSongIds:['B'],sort_order:17,catalogVariantId:'shared-master'},
  {songId:'B',title:'Pair',artist:'Artist',cat:'華語',artistType:'其他',new:false,tags:[],creditCost:0.5}
 ];
 const input=formFixture({bulk,mode,member}),calls=[],preview={textContent:''};let html='',save;
 const context=vm.createContext({
  state:publicView(full,{role:'admin'},now),list,NEW_PRACTICE_TAG,isNewPracticeSong,newPracticeSongTags,newPracticeDate,fateCategories,FormData:FixtureFormData,JSON,Date,Set,
  h:escape,check,field,nativeSelect:(name,label)=>'<label>'+label+'<select name="'+name+'"></select></label>',select:(name,label)=>'<label>'+label+'<select name="'+name+'"></select></label>',area:()=>'',hostName:()=> 'QA',plays:()=>0,
  catalogTemplateChoices:async(_kind,_current,fallback)=>fallback,catalogSongEditStatus:()=>'',installSongAutocomplete:()=>{},proxyDraft:null,
  $:selector=>selector==='#modal-form'?input.form:selector==='#batch-preview'?preview:null,
  modal:(_title,body,callback)=>{html=body;save=callback;},formData:()=>({title:'Original',artist:'Artist',cat:'華語',artistType:'其他',creditCost:0.5,shortMode:'both'}),
  selectedSongs:new Set(['A']),songUndo:null,songUndoTimer:null,setTimeout:()=>({}),clearTimeout:()=>{},renderSongResults:()=>{},toast:()=>{},
  song:id=>context.state.songs.find(row=>row.songId===id),
  dispatch:async(type,data)=>{calls.push({type,data:plain(data)});full=mutate(full,{type,data},{role:'admin'},now);context.state=publicView(full,{role:'admin'},now);},
  filters:{q:'',tags:[]},tagsExpanded:false,scheduleRoomLanguages:()=>{},languageOptionsHtml:()=>'',sortControl:()=>'',isAdmin:()=>true,button:()=>''
 });
 vm.runInContext(helpers,context);vm.runInContext(segment('async function editSong(','function editCrown('),context);
 for(const prefix of ['const songEditFields=','async function bulkEditSongs()','function bulkSongData(','function updateBulkPreview(','function songToolbar('])vm.runInContext(line(prefix),context);
 return {...input,context,calls,preview,run:code=>vm.runInContext(code,context),html:()=>html,save:()=>save(new FixtureFormData(input.form)),full:()=>full};
}

test('book, single edit and bulk edit derive one reserved tag even when legacy settings and song tags omit it',async()=>{
 const h=harness();const before=structuredClone(h.context.state);assert.deepEqual(plain(h.run('songTagVocabulary()')),['新練']);
 assert.match(h.run('songToolbar()'),/data-filter-tag="新練"/);await h.run('editSong("A")');
 assert.match(h.html(),/name="new" checked/);assert.match(h.html(),/name="tags" value="新練" checked/);
 await h.run('bulkEditSongs()');assert.match(h.html(),/name="tags" value="新練"/);assert.deepEqual(h.context.state,before);assert.equal(h.calls.length,0);
 h.context.state.settings.tags=['甜歌','新練'];assert.deepEqual(plain(h.run('songTagVocabulary()')),['甜歌','新練']);assert.equal(h.run('songTagVocabulary().filter(tag=>tag==="新練").length'),1);
});

test('single edit synchronizes the explicit new checkbox and reserved/custom tag choices, preserving unknown historical dates and protected fields',async()=>{
 const h=harness();await h.run('editSong("A")');const protectedBefore=structuredClone(h.full().songs[0]);await h.save();
 assert.equal(h.full().songs[0].new,true);assert.equal(h.full().songs[0].newPracticeAt,undefined);assert.deepEqual(h.full().songs[0].tags,['甜歌','新練']);
 h.form.elements.new.checked=false;h.form.elements.customTags.value='新練,古風';h.events('change',h.form.elements.new);assert.equal(h.reserved.checked,false);assert.equal(h.form.elements.customTags.value,'古風');
 await h.save();assert.equal(h.full().songs[0].new,false);assert.equal(h.full().songs[0].newPracticeAt,null);assert.equal(h.full().songs[0].tags.includes('新練'),false);
 h.reserved.checked=true;h.events('change',h.reserved);assert.equal(h.form.elements.new.checked,true);await h.save();assert.equal(h.full().songs[0].newPracticeAt,now);
 h.reserved.checked=false;h.events('change',h.reserved);assert.equal(h.form.elements.new.checked,false);
 h.form.elements.customTags.value='古風,新練';h.events('input',h.form.elements.customTags);assert.equal(h.form.elements.new.checked,true);assert.equal(h.reserved.checked,true);
 for(const key of ['lyrics','privateNotes','key','creditCost','shortMode','pairSongIds','sort_order','catalogVariantId'])assert.deepEqual(h.full().songs[0][key],protectedBefore[key],key);
 assert.equal(h.calls.length,3);
});

test('bulk reserved tag add/remove and replacement synchronize explicit membership and preview before one write',async()=>{
 for(const [mode,checked,enabled] of [['add',true,true],['remove',true,false],['replace',true,true],['replace',false,false],['clear',false,false]]){
  const h=harness({bulk:true,mode,member:mode==='add'?false:true,dated:mode!=='add'});await h.run('bulkEditSongs()');h.reserved.checked=checked;
  h.events('change',mode==='clear'?h.form.elements.tagMode:h.reserved);
  assert.equal(h.form.elements.new.value,String(enabled),mode);assert.match(h.preview.textContent,enabled?/設為新練/:/取消新練/);
  await h.save();assert.equal(h.calls.length,1);assert.equal(h.full().songs[0].new,enabled);assert.equal(h.full().songs[0].tags.includes('新練'),enabled);
  assert.equal(h.full().songs[0].newPracticeAt,enabled?(mode==='add'?now:'2026-09-01T00:00:00.000Z'):null);
  assert.equal(h.full().songs[0].lyrics,'PRIVATE_BODY');assert.equal(h.full().songs[0].key,'Am');assert.equal(h.full().songs[0].creditCost,0.5);
 }
});

test('bulk explicit membership wins consistently over tag removal/clear, and unchanged ordinary tag edits keep the old date',async()=>{
 for(const [mode,enabled,checked] of [['remove',true,false],['remove',false,true],['clear',true,true],['add',false,false]]){
  const h=harness({bulk:true,mode,member:true,dated:true});await h.run('bulkEditSongs()');h.reserved.checked=!checked;h.form.elements.new.value=String(enabled);h.events('change',h.form.elements.new);
  assert.equal(h.reserved.checked,checked,mode);h.form.elements.creditCost.value='0.5';h.events('input',h.form.elements.creditCost);assert.equal(h.form.elements.new.value,String(enabled));await h.save();assert.equal(h.calls[0].data.new,enabled);assert.equal(h.full().songs[0].new,enabled);assert.equal(h.full().songs[0].tags.includes('新練'),enabled);
  assert.equal(h.full().songs[0].newPracticeAt,enabled?'2026-09-01T00:00:00.000Z':null);
 }
 const ordinary=harness({bulk:true,mode:'add',member:true,dated:true});await ordinary.run('bulkEditSongs()');ordinary.ordinary.checked=true;ordinary.events('change',ordinary.ordinary);
 assert.equal(ordinary.form.elements.new.value,'');await ordinary.save();assert.equal(Object.hasOwn(ordinary.calls[0].data,'new'),false);assert.equal(ordinary.full().songs[0].newPracticeAt,'2026-09-01T00:00:00.000Z');assert.deepEqual(ordinary.full().songs[0].tags,['甜歌','新練']);
});

test('custom reserved tag input and switching bulk tag modes keep form selections and the final Core result aligned',async()=>{
 const h=harness({bulk:true,mode:'keep',member:false});await h.run('bulkEditSongs()');h.form.elements.customTags.value='古風,新練';h.events('input',h.form.elements.customTags);
 assert.equal(h.form.elements.tagMode.value,'add');assert.equal(h.form.elements.new.value,'true');assert.equal(h.reserved.checked,true);
 h.form.elements.tagMode.value='remove';h.events('change',h.form.elements.tagMode);assert.equal(h.form.elements.new.value,'false');
 h.form.elements.new.value='true';h.events('change',h.form.elements.new);assert.equal(h.reserved.checked,false);assert.equal(h.form.elements.customTags.value,'古風');
 await h.save();assert.equal(h.full().songs[0].new,true);assert.equal(h.full().songs[0].newPracticeAt,now);assert.deepEqual(h.full().songs[0].tags,['甜歌','新練']);assert.equal(h.calls.length,1);
});
