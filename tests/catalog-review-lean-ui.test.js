import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const renderSource=source.slice(source.indexOf('function catalogReviewHtml()'),source.indexOf('async function scanCatalogCandidates()'));
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function render(section){
 const catalogView={
  section,page:0,pageSize:20,total:1,items:[],groups:[{
   id:'g1',total:2,rows:[
    {id:'c1',title:'歌曲 <測試>',artist:'歌手 A',versionLabel:'原版',streamerId:'papa'},
    {id:'c2',title:'歌曲 <測試>',artist:'歌手 A',versionLabel:'現場版',streamerId:'friend'}
   ]
  }],
  selected:new Set(),selectedRows:new Map(),search:'',language:'',counts:{},loading:false,
  filterOptions:{},membership:'missing'
 };
 const context=vm.createContext({
  catalogView,state:{streamers:[{id:'papa',display_name:'怕怕'},{id:'friend',display_name:'朋友'}]},
  isSuperAdmin:()=>true,h,
  button:(label,action,id)=>'<button data-act="'+action+'" data-id="'+(id||'')+'">'+label+'</button>',
  blank:()=>'',catalogPager:()=>'',membershipTabs:()=>'',sortControl:()=>'',versionOptions:()=>'',time:x=>x
 });
 vm.runInContext(renderSource,context);
 return vm.runInContext('catalogReviewHtml()',context);
}

test('duplicate review only has row-level existing-song linking, with inline current-group comparison',()=>{
 const html=render('duplicates');
 assert.doesNotMatch(html,/關聯既有共同版本/);
 assert.equal((html.match(/data-act="catalogVersionSource"/g)||[]).length,2);
 assert.match(html,/本組疑似重複的待審來源/);
 assert.match(html,/歌曲 &lt;測試&gt;｜歌手 A｜現場版/);
 assert.doesNotMatch(html,/歌曲 <測試>/);
 assert.match(html,/不代表已確認的共同曲庫關聯/);
});

test('single pending retains original page-selection and batch approval workflow',()=>{
 const html=render('singles');
 assert.match(html,/data-act="catalogSelectPage"/);
 assert.match(html,/data-act="catalogReviewAction"/);
 assert.match(html,/批次通過單筆待審/);
});
