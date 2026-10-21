import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/app.js','utf8');
const headerSource=source.split('\n').find(line=>line.startsWith('function header(){'));
const managementSource=source.split('\n').find(line=>line.startsWith('const managementEntry=createManagementEntry('));
function fixture(){
 let generation=0,decoratedGeneration=-1,calls=0,wide=false,change;
 const header={set innerHTML(value){this.html=value;generation++;},get innerHTML(){return this.html;}};
 const context=vm.createContext({document:{},window:{matchMedia:()=>({matches:wide})},route:'home',demo:false,
  me:()=>({name:'測試'}),session:{loginId:'test'},admin:null,h:String,button:(label,act)=>`<button data-act="${act}">${label}</button>`,
  $:()=>header,state:{streamers:[{id:'r1',slug:'papa',display_name:'怕怕',active:true}]},streamerSlug:'papa',
  hostName:()=> '怕怕',isAdmin:()=>false,isSuperAdmin:()=>false,entryMembershipCount:0,
  notifications:{button:()=>'',audioButton:()=>''},chat:{button:()=>''},board:{button:()=>''},appStartButton:()=>'',
  appInstall:{snapshot:()=>({installed:false})},managementPage:()=>false,render:()=>assert.fail('Header-only update must not rerender business content'),
  createManagementEntry(options){change=options.changed;return {state:()=>({ready:true,capabilities:{allowed:false}})};},
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
