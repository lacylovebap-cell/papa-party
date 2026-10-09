import {newPracticeSongs} from '../src/new-practice.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fateCategories,drawSong} from '../src/fate.js';
import {venuePolicySettings} from '../src/venue-policy.js';

const app=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const rendering=app.slice(app.indexOf('function fateResultHtml()'),app.indexOf('\nfunction recommendSongs('));
const change=app.split(/\r?\n/).find(line=>line.startsWith("document.addEventListener('change'")&&line.includes("'fate-category'"));
const drawStart=app.indexOf("case 'fate':{"),draw=app.slice(drawStart,app.indexOf('\ncase ',drawStart+5));
function ui(){
 const nodes={'#app':{innerHTML:''},'#fate-result':{innerHTML:''},'#fate-category':{value:'all'}};
 let onChange;
 const ctx=vm.createContext({fateCategories,drawSong,venuePolicySettings,newPracticeSongs,structuredClone,document:{addEventListener:(type,fn)=>{if(type==='change')onChange=fn;}},$:selector=>nodes[selector]});
 vm.runInContext(`
  var state={settings:{status:'空閒中',tags:['古風','甜歌'],home:{},manual:''},songs:[{songId:'g',title:'古風歌曲',artist:'歌手甲',tags:['古風']},{songId:'s',title:'甜歌歌曲',artist:'歌手乙',tags:['甜歌']}],players:[],queue:[],crowns:[],cards:[],streamers:[],currentStreamer:{display_name:'QA'}},fateCategory='all',fateSeen=[],fateId=null,streamerSlug='qa',offset=0;
  function h(x){return String(x??'');}function clock(){return '2026-09-28T10:00:00Z';}function me(){return null;}function hostName(){return 'QA';}function hostText(x){return x;}function plays(){return 0;}function recommendSongs(){return [];}function normalizeHome(){return {order:['fate'],visible:{fate:true},imageMode:'none',fieldOrder:[],fields:{}};}function stats(){return {};}function hour(){return '';}function blank(){return '';}function songRows(){return '';}function photoCarousel(){return '';}function crownsHtml(){return '';}function dayLabel(){return '';}function statsHtml(){return '';}function crownFor(){return null;}function toast(){return '';}function switchStreamer(){}function card(title,body){return body;}function button(label,action,id=''){return '<button data-act="'+action+'" data-id="'+id+'">'+label+'</button>';}
 `+rendering+'\n'+change+'\nfunction clickDraw(){switch("fate"){'+draw+'}}',ctx);
 return {ctx,nodes,select(value){nodes['#fate-category'].value=value;onChange({target:{id:'fate-category',value}});},run(code){return vm.runInContext(code,ctx);}};
}
test('choosing a draw tag survives a home refresh before clicking draw, and the chosen result survives later refreshes',()=>{
 const u=ui();u.run('renderHome()');u.select('tag:古風');u.run('renderHome()');
 assert.match(u.nodes['#app'].innerHTML,/<option value="tag:古風" selected>/);assert.equal(u.run('fateCategory'),'tag:古風');
 u.run('clickDraw()');assert.equal(u.run('fateId'),'g');assert.match(u.nodes['#fate-result'].innerHTML,/古風歌曲/);
 u.run('state=structuredClone(state);renderHome()');assert.match(u.nodes['#app'].innerHTML,/古風歌曲/);assert.match(u.nodes['#app'].innerHTML,/<option value="tag:古風" selected>/);
});
test('changing tags clears the previous result and the next draw uses only the newly selected tag',()=>{
 const u=ui();u.select('tag:古風');u.run('clickDraw()');u.select('tag:甜歌');
 assert.equal(u.run('fateId'),null);assert.equal(u.run('fateSeen.length'),0);assert.doesNotMatch(u.nodes['#fate-result'].innerHTML,/古風歌曲/);
 u.run('renderHome();clickDraw();renderHome()');assert.equal(u.run('fateId'),'s');assert.match(u.nodes['#app'].innerHTML,/甜歌歌曲/);
});
test('a result whose song no longer has the chosen tag is removed on refreshed catalog data',()=>{
 const u=ui();u.select('tag:古風');u.run('clickDraw();state.songs[0].tags=["甜歌"];renderHome()');assert.doesNotMatch(u.nodes['#app'].innerHTML,/古風歌曲/);assert.match(u.nodes['#app'].innerHTML,/讓命運幫你選一首/);
});
