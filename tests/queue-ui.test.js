import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {timeValue,stamp,quoteSong} from '../src/core.js';

const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8'),lines=app.split(/\r?\n/);
const line=prefix=>lines.find(x=>x.startsWith(prefix));
const helpers=['const field=','const area=','const nativeSelect=','const check=','const formData=','const dateInput=','const isoInput='].map(line).join('\n');
const escaping='const '+line('const $=').slice(line('const $=').indexOf('h='));
const functions=[line('function select('),line('function shortSongOptions('),line('function queueLyrics('),app.slice(app.indexOf('function editQueue('),app.indexOf('\nfunction onBehalf(')),line('function allocateDialog(')].join('\n');
const unescape=value=>String(value).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function harness({repeat=false,pairOnly=false}={}){
 const songs=[{songId:'a',title:'短歌 <A>',artist:'歌手甲',creditCost:0.5,shortMode:pairOnly?'pair':'both',pairSongIds:['b'],lyrics:'第一行\n<script>alert(1)</script>'},{songId:'b',title:'短歌 B',artist:'歌手乙',creditCost:0.5,lyrics:'B & 下一行'},{songId:'double',title:'兩首歌',artist:'歌手丙',creditCost:2,lyrics:''}];
 const q={id:'q',playerId:'p',songId:'a',title:'原歌名',artist:'原歌手',kind:'saved',status:'waiting',at:'2026-09-27T15:22:34Z',creditCost:1,selfProvided:true,note:'原備註',items:repeat?[{songId:'a',title:'原短歌',artist:'原歌手',performances:2}]:[{songId:'a',title:'原短歌 <A>',artist:'原歌手',performances:1},{songId:'b',title:'原短歌 B',artist:'另一歌手',performances:1}]};
 const fields={},listeners={},nodes={'#queue-edit-cost':{textContent:''}},sent=[];let captured;
 function options(html){return [...html.matchAll(/<option value="([^"]*)"([^>]*)>(.*?)<\/option>/gs)].map(m=>({value:unescape(m[1]),selected:m[2].includes('selected')}));}
 const holder={_html:'',get innerHTML(){return this._html;},set innerHTML(html){this._html=html;delete fields.pairSongId;const match=html.match(/<select name="pairSongId">(.*?)<\/select>/s);if(match){const choices=options(match[1]);fields.pairSongId={options:choices,value:(choices.find(o=>o.selected)||choices[0])?.value||'',insertAdjacentHTML(position,extra){this.options.push(...options(extra));}};}}};
 nodes['#queue-edit-options']=holder;nodes['#modal-form']={addEventListener:(event,fn)=>listeners[event]=fn};
 const ctx=vm.createContext({Date,Map,Object,timeValue,stamp,quoteSong,setTimeout:fn=>fn(),state:{songs,queue:[q],ledger:[],crowns:[],settings:{livePrice:2990,liveDouble:500}},
  $:selector=>selector.startsWith('#dialog [name=')?fields[selector.slice(14,-1)]:nodes[selector],
  modal:(title,html,submit)=>{captured={title,html,submit};for(const match of html.matchAll(/<input\b([^>]+)>/g)){const attrs=match[1],name=attrs.match(/name="([^"]+)"/)?.[1];if(name)fields[name]={value:unescape(attrs.match(/value="([^"]*)"/)?.[1]||''),checked:attrs.includes('checked')};}for(const m of html.matchAll(/<textarea name="([^"]+)"[^>]*>(.*?)<\/textarea>/gs))fields[m[1]]={value:unescape(m[2])};},
  dispatch:async(type,data)=>sent.push({type,data:structuredClone(data)}),toast:()=>{},song:id=>songs.find(s=>s.songId===id),clock:()=> '2026-09-28T00:00:00Z',playerName:()=> '玩家 <P>',playerOptions:()=> [['p','玩家']],button:()=>''});
 vm.runInContext(escaping+'\n'+helpers+'\n'+functions,ctx);
 return {ctx,fields,nodes,sent,get modal(){return captured;},run:code=>vm.runInContext(code,ctx),async submit(extra={}){const data=new Map(Object.entries(fields).filter(([name,field])=>name!=='selfProvided'||field.checked).map(([name,field])=>[name,field.value]));for(const [name,value] of Object.entries(extra))value===null?data.delete(name):data.set(name,value);await captured.submit(data);},change(){listeners.change();}};
}
test('paired queue lyrics show both songs as escaped text and missing lyrics have a usable fallback',()=>{
 const u=harness();u.run("queueLyrics('q')");assert.match(u.modal.html,/原短歌 &lt;A&gt;/);assert.match(u.modal.html,/原短歌 B/);assert.match(u.modal.html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.match(u.modal.html,/B &amp; 下一行/);assert.doesNotMatch(u.modal.html,/<script>/);assert.match(u.modal.html,/第一行\n/);
 u.run("state.queue[0].items=[{songId:'missing',title:'已刪除歌曲'}];queueLyrics('q')");assert.match(u.modal.html,/尚未填入歌詞/);
});
test('note-only editing keeps the original pair, original quote and second-precision request time',async()=>{
 const u=harness();u.run("state.songs[0].creditCost=2;editQueue('q')");assert.equal(u.fields.pairSongId.value,'b');assert.match(u.nodes['#queue-edit-cost'].textContent,/扣 1 首/);assert.equal(u.fields.at.value,'2026-09-27T23:22');
 await u.submit({note:'只改備註'});assert.deepEqual(u.sent,[{type:'queue',data:{id:'q',operation:'edit',songId:'a',pairSongId:'b',selfProvided:true,note:'只改備註'}}]);assert.equal(Object.hasOwn(u.sent[0].data,'at'),false);
});
test('an original repeat quote remains selected after the catalog switches to pair-only',async()=>{
 const u=harness({repeat:true,pairOnly:true});u.run("editQueue('q')");assert.equal(u.fields.pairSongId.value,'');assert.ok(u.fields.pairSongId.options.some(o=>o.value===''));await u.submit({note:'保留唱兩次'});assert.equal(u.sent[0].data.pairSongId,'');assert.equal(Object.hasOwn(u.sent[0].data,'at'),false);
});
test('replacement preview and payload carry the chosen song, self-provided flag and an explicitly changed time',async()=>{
 const u=harness();u.run("editQueue('q')");u.fields.songId.value='double';u.fields.selfProvided.checked=false;u.change();assert.match(u.nodes['#queue-edit-cost'].textContent,/扣 2 首/);assert.equal(u.fields.pairSongId,undefined);
 await u.submit({at:'2026-09-27T23:24',note:'换歌'});assert.deepEqual(u.sent[0],{type:'queue',data:{id:'q',operation:'edit',songId:'double',pairSongId:'',selfProvided:false,note:'换歌',at:'2026-09-27T15:24:00.000Z'}});
});
test('allocation collects each row self-provided and completed choice independently',async()=>{
 const u=harness();u.run('allocateDialog()');const row=(songId,selfProvided,completed,pairSongId='')=>({querySelector:selector=>selector==='[name=songId]'?{value:songId}:selector==='[name=pairSongId]'?{value:pairSongId}:{checked:selector==='[name=selfProvided]'?selfProvided:completed}});
 await u.modal.submit(new Map([['playerId','p'],['total','3'],['stored','1'],['effective_at','2026-09-27T23:22']]),{querySelectorAll:()=>[row('a',true,false,'b'),row('a',false,true)]});
 assert.equal(u.sent[0].type,'allocate');assert.deepEqual(u.sent[0].data.items,[{songId:'a',pairSongId:'b',completed:false,selfProvided:true},{songId:'a',pairSongId:'',completed:true,selfProvided:false}]);assert.equal(u.sent[0].data.effective_at,'2026-09-27T15:22:00.000Z');
});
