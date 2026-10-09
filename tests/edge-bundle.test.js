import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import {execFileSync} from 'node:child_process';
test('complete edge bundle compiles, preserves URL validators and isolates chat before database access',async()=>{
 execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
 const source=fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
 let handler;const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.supabase.co':'test'},serve:h=>handler=h},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('unexpected fetch');}});
 vm.runInContext(stripTypeScriptTypes(source),context);assert.equal(typeof handler,'function');
 assert.equal(vm.runInContext("validateHome({...normalizeHome(),imageMode:'custom',imageUrl:'https://example.com/photo.webp'}).imageMode",context),'custom');
 assert.equal(vm.runInContext("validPushSubscription({endpoint:'https://fcm.googleapis.com/test',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}})",context),true);
 await assert.rejects(vm.runInContext("chatOperation({op:'chatMessages',streamer:'papa',playerId:'P2'},{role:'player',playerId:'P1'},upgradePlatform(empty()))",context),/無法查看/);
 await assert.rejects(vm.runInContext("chatOperation({op:'chatInbox',streamer:'papa'},{role:'streamer_admin',streamer_id:'other'},upgradePlatform(empty()))",context),/自己的主播/);
 await assert.rejects(vm.runInContext("boardOperation({op:'boardList'},null,upgradePlatform(empty()))",context),/請先登入/);
 vm.runInContext(`
  var fixture={id:'bd310611-7792-45f6-810f-1ea9bd75a014',seq:1,scope:'streamer',streamer_id:'papa',author_key:'player:A',root_id:null,visibility:'include',targets:['player:B'],anonymous:true,body:'private',deleted:false,version:1};
  api=async(path,body)=>{if(body)throw Error('unexpected mutation');return path.includes('papa_board_blocks')?[]:[fixture];};
 `,context);
 const denied=await vm.runInContext("boardOperation({op:'boardList'},{role:'player',playerId:'C'},upgradePlatform(empty()))",context);assert.equal(denied.rows.length,0);
 const allowed=await vm.runInContext("boardOperation({op:'boardList'},{role:'player',playerId:'B'},upgradePlatform(empty()))",context);assert.equal(allowed.rows[0].body,'private');assert.equal(allowed.rows[0].managedAuthor,undefined);assert.equal(allowed.rows[0].author_key,undefined);
 await assert.rejects(vm.runInContext("boardOperation({op:'boardList',rootId:fixture.id},{role:'player',playerId:'C'},upgradePlatform(empty()))",context),/無權查看/);
 await assert.rejects(vm.runInContext("boardOperation({op:'boardChange',id:fixture.id,action:'remove',version:1},{role:'player',playerId:'B'},upgradePlatform(empty()))",context),/無法修改/);
 await assert.rejects(vm.runInContext("boardOperation({op:'boardBlock',id:fixture.id},{role:'player',playerId:'B'},upgradePlatform(empty()))",context),/匿名留言/);
 vm.runInContext("fixture.targets=['streamer:other'];actor=async()=>({role:'streamer_admin',streamer_id:'other'});load=async()=>upgradePlatform(empty());loadCommunicationState=async()=>upgradePlatform(empty());",context);
 const boardResponse=await handler({method:'POST',json:async()=>({op:'boardList',token:'test',streamer:'papa'})});assert.equal(boardResponse.status,200);assert.equal((await boardResponse.json()).rows[0].body,'private');
 const adminResponse=await handler({method:'POST',json:async()=>({op:'read',token:'test',streamer:'papa'})});assert.equal(adminResponse.status,400);assert.match((await adminResponse.json()).error,/自己的主播/);
 // Failed-quota events must use the same server-side pool selection as the
 // request itself, without trusting a player's supplied venue or combining pools.
 vm.runInContext(`
  var venueTime=new Date().toISOString(),venueState=upgradePlatform(empty()),venueCalls=[];
  venueState.players=[{playerId:'VP',name:'Venue Player',ids:[],names:[]}];
  venueState.songs=[{songId:'VS',streamer_id:'papa',title:'Weighted',artist:'Artist',creditCost:2}];
  venueState.streamerSettings.papa={...venueState.streamerSettings.papa,radio_enabled:true,current_space:'radio',hourlyLimit:0};
  actor=async()=>({role:'player',playerId:'VP',spaceId:'space-001'});
  load=async()=>structuredClone(venueState);schedulePush=()=>{};
  api=async(path,body)=>{venueCalls.push({path,body});return true;};
 `,context);
 for(const [radio,shengma,reserved,counted] of [[0,4,0,true],[1,1,0,false],[2,0,0,true],[2,0,1,false]]){
  context.radioAmount=radio;context.shengmaAmount=shengma;context.reservedAmount=reserved;
  vm.runInContext(`venueCalls.length=0;venueState.ledger=[{id:'R',streamer_id:'papa',playerId:'VP',amount:radioAmount,storage_pool:'radio'},{id:'S',streamer_id:'papa',playerId:'VP',amount:shengmaAmount}];venueState.queue=reservedAmount?[{id:'Q',streamer_id:'papa',playerId:'VP',kind:'saved',status:'waiting',creditCost:reservedAmount,venue:'radio',consumed_storage_pool:'radio',at:venueTime}]:[];`,context);
  const result=await handler({method:'POST',json:async()=>({op:'failedRequest',token:'test',streamer:'papa',songId:'VS',venue:'shengma',consumed_storage_pool:'radio'})});
  assert.equal(result.status,200);assert.equal((await result.json()).counted,counted);
  assert.equal(context.venueCalls.length,counted?1:0);if(counted)assert.equal(context.venueCalls[0].body.room_id,'papa');
 }
 vm.runInContext(`
  var playerPageCalls=[];
  api=async(path,body)=>{playerPageCalls.push({path,body});if(path.endsWith('papa_streamer_directory'))return [{id:'michelle',slug:'michelle',active:true,spaceId:'space-001'}];if(path.endsWith('papa_player_management_page'))return {rows:[],total:0,pageLimit:body.page_limit,pageOffset:body.page_offset};throw Error('unexpected player-page query');};
 `,context);
 const deniedPage=await handler({method:'POST',json:async()=>({op:'playerManagementPage',token:'test',streamer:'michelle',mode:'all'})});assert.equal(deniedPage.status,400);assert.equal(context.playerPageCalls.length,0);
 vm.runInContext("actor=async()=>({role:'streamer_admin',streamer_id:'michelle',spaceId:'space-001'});load=async()=>{throw Error('player page must not load business histories');};",context);
 const page=await handler({method:'POST',json:async()=>({op:'playerManagementPage',token:'test',streamer:'michelle',mode:'stored',page:2,limit:20,query:' A '})});assert.equal(page.status,200);assert.equal((await page.json()).pageOffset,40);
 const pageCall=context.playerPageCalls.find(call=>call.path.endsWith('papa_player_management_page'));assert.deepEqual(JSON.parse(JSON.stringify(pageCall.body)),{requested_space:'space-001',requested_room:'michelle',list_mode:'stored',query_text:'A',page_limit:20,page_offset:40});
 for(const extra of [{limit:51},{page:-1},{query:'x'.repeat(101)},{mode:'other'},{page:10000001}]){
  context.playerPageCalls.length=0;const bad=await handler({method:'POST',json:async()=>({op:'playerManagementPage',token:'test',streamer:'michelle',mode:'all',...extra})});assert.equal(bad.status,400);assert.ok(context.playerPageCalls.every(call=>!call.path.endsWith('papa_player_management_page')));
 }
 context.playerPageCalls.length=0;const foreign=await handler({method:'POST',json:async()=>({op:'playerManagementPage',token:'test',streamer:'papa',mode:'all'})});assert.equal(foreign.status,400);assert.ok(context.playerPageCalls.every(call=>!call.path.endsWith('papa_player_management_page')));
 vm.runInContext(`
  var practiceCalls=[];actor=async()=>null;
  api=async(path,body)=>{practiceCalls.push({path,body});if(path.endsWith('papa_streamer_directory'))return [{id:'michelle',slug:'michelle',active:true,spaceId:'space-001'}];if(path.endsWith('papa_new_practice_page'))return {rows:[],total:0,pageLimit:body.page_limit,pageOffset:body.page_offset};throw Error('unexpected practice query');};
 `,context);
 const practice=await handler({method:'POST',json:async()=>({op:'newPracticePage',streamer:'michelle',page:1,limit:20})});assert.equal(practice.status,200);assert.equal((await practice.json()).pageOffset,20);
 assert.equal(context.practiceCalls.length,2);assert.deepEqual(JSON.parse(JSON.stringify(context.practiceCalls[1].body)),{requested_space:'space-001',requested_room:'michelle',management:false,page_limit:20,page_offset:20});
 context.practiceCalls.length=0;const privatePractice=await handler({method:'POST',json:async()=>({op:'newPracticePage',streamer:'michelle',management:true})});assert.equal(privatePractice.status,400);assert.equal(context.practiceCalls.length,0);
 vm.runInContext("actor=async()=>({role:'streamer_admin',streamer_id:'michelle',spaceId:'space-001'});",context);
 for(const extra of [{limit:51},{page:-1},{page:10000001},{management:'true'},{streamer:'papa'}]){context.practiceCalls.length=0;const bad=await handler({method:'POST',json:async()=>({op:'newPracticePage',streamer:'michelle',management:true,...extra})});assert.equal(bad.status,400);assert.ok(context.practiceCalls.every(call=>!call.path.endsWith('papa_new_practice_page')));}
 context.practiceCalls.length=0;const managedPractice=await handler({method:'POST',json:async()=>({op:'newPracticePage',streamer:'michelle',management:true})});assert.equal(managedPractice.status,200);assert.equal(context.practiceCalls[1].body.management,true);
 vm.runInContext(`
  var favoriteCalls=[];
  api=async(path,body)=>{favoriteCalls.push({path,body});if(path.endsWith('papa_streamer_directory'))return [{id:'michelle',slug:'michelle',active:true,spaceId:'space-001'}];if(path.endsWith('papa_song_favorite_set'))return {songId:body.requested_song,favorite:body.requested_favorite,changed:true};if(path.endsWith('papa_song_favorite_flags'))return {songIds:[]};if(path.endsWith('papa_song_favorites_page'))return {rows:[],total:0,pageLimit:body.page_limit,pageOffset:body.page_offset};throw Error('unexpected favorite query');};
 `,context);
 for(const identity of [null,{role:'streamer_admin',streamer_id:'michelle',accountId:'account-manager'}, {role:'player',playerId:'P1'}]){
  context.favoriteWho=identity;vm.runInContext('actor=async()=>favoriteWho;',context);context.favoriteCalls.length=0;
  const denied=await handler({method:'POST',json:async()=>({op:'favoriteSet',streamer:'michelle',songId:'S1',favorite:true})});assert.equal(denied.status,400);assert.equal(context.favoriteCalls.length,0);
 }
 context.favoriteWho={role:'player',playerId:'P1',accountId:'actual-account',spaceId:'space-001'};
 const setFavorite=await handler({method:'POST',json:async()=>({op:'favoriteSet',token:'test',streamer:'michelle',songId:'S1',favorite:true,playerId:'P2',account_id:'forged-account',actor_context:{role:'super_admin'}})});assert.equal(setFavorite.status,200);
 assert.deepEqual(JSON.parse(JSON.stringify(context.favoriteCalls[1].body)),{requested_space:'space-001',requested_room:'michelle',actor_context:{role:'player',account_id:'actual-account',player_id:'P1',space_id:'space-001',streamer_id:'michelle'},requested_song:'S1',requested_favorite:true});
 for(const body of [{op:'favoriteFlags',songIds:Array(51).fill('S1')},{op:'favoriteFlags',songIds:['S1','S1']},{op:'favoriteSet',songId:'S1',favorite:'true'},{op:'favoritesPage',limit:51},{op:'favoritesPage',page:-1}]){context.favoriteCalls.length=0;const bad=await handler({method:'POST',json:async()=>({streamer:'michelle',...body})});assert.equal(bad.status,400);assert.ok(context.favoriteCalls.every(call=>call.path.endsWith('papa_streamer_directory')));}
 context.favoriteCalls.length=0;const favoritePage=await handler({method:'POST',json:async()=>({op:'favoritesPage',streamer:'michelle',page:2,limit:20})});assert.equal(favoritePage.status,200);assert.equal(context.favoriteCalls[1].body.page_offset,40);
});
