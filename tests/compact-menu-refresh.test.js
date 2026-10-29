import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/app.js','utf8');
const headerSource=source.split('\n').find(line=>line.startsWith('function header(){'));
const managementSource=source.split('\n').find(line=>line.startsWith('const managementEntry=createManagementEntry('));
function fixture({player=true,manager=null,president=false}={}){
 let generation=0,decoratedGeneration=-1,calls=0,wide=false,change;
 const header={set innerHTML(value){this.html=value;generation++;},get innerHTML(){return this.html;}};
 const context=vm.createContext({inNativeSpace:()=>false,nativeNoticesOff:()=>false,commonBookShown:()=>true,document:{},window:{matchMedia:()=>({matches:wide})},route:'home',demo:false,
  me:()=>player?({name:'測試'}):null,session:player?{loginId:'test'}:null,admin:manager,h:String,button:(label,act)=>`<button data-act="${act}">${label}</button>`,
  $:()=>header,state:{streamers:[{id:'r1',slug:'papa',display_name:'怕怕',active:true}]},streamerSlug:'papa',
  hostName:()=> '怕怕',isAdmin:()=>!!manager,isSuperAdmin:()=>manager?.role==='super_admin',entryMembershipCount:0,
  notifications:{button:()=>'',audioButton:()=>''},chat:{button:()=>''},board:{button:()=>''},appStartButton:()=>'',
  appInstall:{snapshot:()=>({installed:false})},managementPage:()=>false,render:()=>assert.fail('Header-only update must not rerender business content'),
  createManagementEntry(options){change=options.changed;return {state:()=>({ready:true,capabilities:{allowed:president,president}})};},
  installCompactMenu(options){assert.equal(options.route,'home');assert.match(header.innerHTML,/header-menu/);decoratedGeneration=generation;calls++;}
 });
 vm.runInContext(headerSource+'\n'+managementSource,context);
 return {header,refresh:()=>context.header(),change:()=>change(),resize(){wide=!wide;context.header();},
  state:()=>({generation,decoratedGeneration,calls})};
}
test('every direct header rebuild decorates its newly created menu, including screen-size changes',()=>{
 const f=fixture();f.refresh();f.resize();f.resize();
 assert.deepEqual(f.state(),{generation:3,decoratedGeneration:3,calls:3});
});
test('late management readiness preserves compact menu without a full business rerender',()=>{
 const f=fixture();f.refresh();f.change();f.change();
 assert.deepEqual(f.state(),{generation:3,decoratedGeneration:3,calls:3});
});


test('header distinguishes player login and logout without exposing the platform centre to ordinary actors',()=>{
 for(const manager of [null,{role:'streamer_admin'}]){
  const anonymous=fixture({player:false,manager});anonymous.refresh();
  assert.match(anonymous.header.innerHTML,/>玩家登入<\/button>/);
  assert.doesNotMatch(anonymous.header.innerHTML,/data-act="platformOpen"/);
  const signed=fixture({manager});signed.refresh();
  assert.match(signed.header.innerHTML,/>玩家登出<\/button>/);
  assert.doesNotMatch(signed.header.innerHTML,/data-act="platformOpen"/);
 }
 const owner=fixture({manager:{role:'super_admin'},president:true});owner.refresh();
 assert.match(owner.header.innerHTML,/data-act="platformOpen"/);
 assert.match(owner.header.innerHTML,/data-manager-signed-in="true"/);
});
