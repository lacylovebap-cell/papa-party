import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pageLocation,pageDestination} from '../src/streamer-navigation.js';
const source=fs.readFileSync('src/app.js','utf8');
const apiSource=source.slice(source.indexOf('async function api(body){'),source.indexOf('\nfunction syncReadIdentity()'));
function fixture(){
 const sent=[];const session={role:'player',accountId:'player',token:'player:existing'};
 const context={nativeRoomSpace:()=>null,session,admin:null,streamerSlug:'alice',API:'https://example.test',PUBLISHABLE_KEY:'public',signatures:{},route:'center',state:{revision:1},offset:0,selectedPlayer:null,
  isAdmin:()=>false,syncReadIdentity:()=> 'stable',supportsOperationReceipt:()=>false,managerSessionExpired:()=>false,acceptSessionIdentity(){},timeValue:Date.parse,webApiFailure:(_status,data)=>Error(data.error),fetch:async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({version:1})};}};
 vm.createContext(context);context.call=vm.runInContext('('+apiSource+')',context);
 return {context,sent,session};
}
test('management centre keeps verified player session without granting a business admin role',async()=>{
 const {context,sent,session}=fixture();await context.call({op:'platformManagementDirectory',management:true,platformSession:true,section:'halls',q:'',page:1});
 assert.equal(sent[0].token,'player:existing');assert.equal(context.session,session);assert.equal(context.admin,null);assert.equal(session.role,'player');
});
test('president session takes precedence and stale Account responses are rejected',async()=>{
 const {context,sent}=fixture();context.admin={role:'super_admin',token:'admin:existing',legacy:true};await context.call({op:'platformManagementSession',platformSession:true});assert.equal(sent[0].token,'admin:existing');
 context.fetch=async()=>{context.admin=null;return {ok:true,json:async()=>({version:1})};};await assert.rejects(context.call({op:'platformManagementSession',platformSession:true}),/身分已變更/);
});
test('scoped management route survives reload while preserving current streamer',()=>{
 const href=pageDestination('https://paparty.app/v2.html?streamer=alice&spaceId=h#home',{route:'center',subtab:'platform'});
 assert.equal(pageLocation(href).subtab,'platform');assert.equal(pageLocation(href).route,'center');assert.equal(new URL(href).searchParams.get('streamer'),'alice');
});
