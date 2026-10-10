import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {isSuper,isManager,requireRoom} from '../src/access-policy.js';

const index=fs.readFileSync(new URL('../supabase/functions/party-api/index.ts',import.meta.url),'utf8');
const catalog=fs.readFileSync(new URL('../supabase/functions/party-api/catalog.ts',import.meta.url),'utf8');
const sortHelper=index.slice(index.lastIndexOf('function checkedListSort'));
const rooms=[{id:'papa',slug:'papa',active:true,spaceId:'space-001'},
 {id:'michelle',slug:'michelle',active:true,spaceId:'space-001'},
 {id:'native-room',slug:'native-room',active:true,spaceId:'space-native'}];
const manager={role:'streamer_admin',accountId:'verified-account',streamer_id:'papa',spaceId:'space-001'};
function fixture(){
 const calls=[];
 const context=vm.createContext({isSuper,isManager,requireRoom,structuredClone,
  api:async(path,body)=>{
   calls.push({path,body:JSON.parse(JSON.stringify(body))});
   if(path.endsWith('papa_streamer_directory'))return rooms;
   return {rows:[{id:'server-variant',title:'Server title',artist:'Server artist'}],total:55,hasMore:true,
    filters:{versionKinds:['original','remix'],versionLabels:['原版','DJ版']}};
  },load:()=>{throw Error('full snapshot read');}});
 vm.runInContext(stripTypeScriptTypes(catalog+'\n'+sortHelper),context);
 const run=async(body,who=manager)=>{context.body=body;context.who=who;return vm.runInContext('catalogOperation(body,who)',context);};
 return {run,calls,context};
}

test('catalog browse/autocomplete sends exact v2 selectors and counts to one canonical Space RPC',async()=>{
 const f=fixture(),result=await f.run({op:'catalogSearch',streamer:'papa',q:' Needle ',membership:'missing',sort:'oldest',versionKind:'remix',versionLabel:'DJ版',limit:10,offset:20,
  spaceId:'space-attacker',requested_space:'space-attacker',room_id:'native-room',accountId:'attacker'});
 assert.equal(result.items.length,1);assert.equal(result.total,55);assert.equal(result.hasMore,true);
 assert.deepEqual(JSON.parse(JSON.stringify(result.filters)),{versionKinds:['original','remix'],versionLabels:['原版','DJ版']});
 assert.deepEqual(f.calls,[{path:'/rest/v1/rpc/papa_streamer_directory',body:{}},
  {path:'/rest/v1/rpc/papa_catalog_search_filtered_v2',body:{query_text:'Needle',page_limit:10,page_offset:20,room_id:'papa',language_filter:null,
   performer_filter:null,search_mode:'metadata',requested_space:'space-001',membership_filter:'missing',sort_order:'oldest',version_filter:'remix',version_label_filter:'DJ版'}}]);
});

test('family relationship page forwards membership before pagination and retains the server family total',async()=>{
 const f=fixture(),result=await f.run({op:'catalogReviewList',status:'families',streamer:'papa',membership:'added',sort:'newest',versionKind:'original',versionLabel:'原版',limit:1,offset:3});
 assert.equal(result.total,55);assert.equal(result.items.length,1);
 assert.deepEqual(f.calls.at(-1),{path:'/rest/v1/rpc/papa_catalog_families_page_v4_in_space',body:{query_text:'',lyrics_filter:'all',language_filter:'',version_filter:'original',
  viewer_room:'papa',requested_space:'space-001',page_limit:1,page_offset:3,membership_filter:'added',sort_order:'newest',version_label_filter:'原版'}});
});

test('public common book has a capped family page and derives its scope from the authorized room',async()=>{
 const f=fixture();await f.run({op:'catalogSongbook',streamer:'native-room',sort:'newest',versionLabel:'DJ版',limit:1000,offset:18,spaceId:'space-001'},
  {role:'player',accountId:'verified-player',playerId:'NATIVE',spaceId:'space-native'});
 assert.deepEqual(f.calls.at(-1),{path:'/rest/v1/rpc/papa_catalog_public_page_filtered_v2_in_space',body:{query_text:'',language_filter:'',performer_filter:'',version_filter:'',
  page_limit:20,page_offset:18,requested_space:'space-native',sort_order:'newest',version_label_filter:'DJ版'}});
});

test('song search defaults tag OR while explicit proxy AND and sort selectors reach the exact v4 signature',async()=>{
 const f=fixture();await f.run({op:'songSearchRoom',streamer:'papa',q:'  國語  ',tags:['新練','情歌'],tagMatch:'all',sort:'oldest',limit:20,offset:40});
 assert.deepEqual(f.calls.at(-1),{path:'/rest/v1/rpc/papa_song_search_room_v4',body:{room_id:'papa',requested_space:'space-001',query_text:'華語',tags:['新練','情歌'],
  page_limit:20,page_offset:40,language_name:null,visibility:'all',catalog_status:'all',sort_order:'oldest',tag_match:'all'}});
 await f.run({op:'songSearchRoom',streamer:'papa',visibility:'hidden',catalogStatus:'pending'},
  {role:'player',playerId:'P1',spaceId:'space-001'});
 assert.equal(f.calls.at(-1).body.tag_match,'any');assert.equal(f.calls.at(-1).body.sort_order,'default');
 assert.equal(f.calls.at(-1).body.visibility,'visible');assert.equal(f.calls.at(-1).body.catalog_status,'all');
});

test('selectors and verified role/room guards reject invalid flags or foreign rooms before any list RPC',async()=>{
 const f=fixture();
 for(const body of [{op:'catalogSearch',sort:'timestamp'},{op:'catalogSearch',membership:'mine'},
  {op:'catalogReviewList',status:'families',membership:null},{op:'catalogSongbook',versionLabel:'x'.repeat(121)},
  {op:'songSearchRoom',tagMatch:'some'},{op:'songSearchRoom',sort:null}]){
  const count=f.calls.length;await assert.rejects(f.run({...body,streamer:'papa'}));
  assert.equal(f.calls.slice(count).some(c=>!c.path.endsWith('papa_streamer_directory')),false);
 }
 for(const op of ['catalogSearch','catalogReviewList'])await assert.rejects(f.run({op,status:'families'},null),/登入/);
 await assert.rejects(f.run({op:'catalogSearch',streamer:'michelle'}),/自己的主播/);
 await assert.rejects(f.run({op:'catalogSongbook',streamer:'native-room'},null));
 assert.equal(f.calls.some(c=>/papa_v2_snapshot|catalog_song_metadata|backup/.test(c.path)),false);
});

test('player management source block derives authority, archive permission and exact v3 order/paging payload',async()=>{
 const f=fixture(),start=index.indexOf(" if(b.op==='playerManagementPage'){"),end=index.indexOf(" if(b.op==='events')",start);
 assert.equal(start>=0&&end>start,true);
 vm.runInContext(stripTypeScriptTypes('async function playerManagement(b:any,who:any){'+index.slice(start,end)+'}'),f.context);
 f.context.respond=value=>value;f.context.body={op:'playerManagementPage',streamer:'papa',mode:'all',page:2,limit:20,query:' Name ',sort:'oldest',spaceId:'space-attacker',actor_context:{role:'super_admin'}};f.context.who=manager;
 await vm.runInContext('playerManagement(body,who)',f.context);
 assert.deepEqual(f.calls.at(-1),{path:'/rest/v1/rpc/papa_player_management_page_v3',body:{requested_space:'space-001',requested_room:'papa',list_mode:'all',query_text:'Name',page_limit:20,page_offset:40,archived_filter:false,sort_order:'oldest'}});
 const count=f.calls.length;f.context.body.archived=true;await assert.rejects(vm.runInContext('playerManagement(body,who)',f.context),/總裁/);assert.equal(f.calls.length,count);
});
