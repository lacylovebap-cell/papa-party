import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
import {empty,mutate} from '../src/core.js';
import {stateEntries} from '../src/state-patch.js';

function edge(allowRead=false){
 execFileSync(process.execPath,['build-edge.mjs'],{cwd:new URL('../',import.meta.url)});
 const code=fs.readFileSync(new URL('../deploy-function.txt',import.meta.url),'utf8').replace(/^import webpush .*;\r?\n/m,'const webpush={};');
 let handler;
 const calls=[];
 const meta={data:{streamers:[{id:'papa',slug:'papa',active:true,display_name:'怕怕'},{id:'michelle',slug:'michelle',active:true,display_name:'米雪'}],streamerSettings:{}}};
 const context=vm.createContext({URL,crypto,structuredClone,TextEncoder,console,Date,Response,Deno:{env:{get:k=>k==='SUPABASE_URL'?'https://example.test':'test'},serve:h=>handler=h},EdgeRuntime:{waitUntil:()=>{}},fetch:()=>{throw Error('unexpected network');}});
 vm.runInContext(stripTypeScriptTypes(code),context);
 context.testActor=null;
 context.mockApi=async(path,body)=>{
  calls.push({path,body});
  if(path.includes('papa_streamer_directory'))return meta.data.streamers;
  if(path.includes('papa_v2_revision?'))return [{revision:7}];
  if(path.includes('papa_v2_scoped_read_snapshot'))return {revision:7,rows:[{kind:'meta',id:'1',data:{schemaVersion:3,...meta.data}},{kind:'settings',id:'1',data:{}}]};
  if(path.includes('papa_catalog_song_metadata'))return [];
  if(path.includes('papa_song_search_room'))return {songIds:['local-song'],total:1,hasMore:false};
  if(path.includes('papa_catalog_search'))return {rows:[{id:'variant-id',title:'公開歌名',artist:'歌手'}],total:1,hasMore:false};
  if(path.includes('papa_catalog_song_links?'))return [{variant_id:'11111111-1111-4111-8111-111111111111'}];
  if(path.includes('papa_catalog_get_lyrics'))return {body:'只供主播看的完整歌詞',revision:2,mode:'shared',privateNote:'換氣',variantId:'11111111-1111-4111-8111-111111111111'};
  if(path.includes('papa_catalog_governance')||path.includes('papa_catalog_language_filter_save'))return {ok:true,revision:8};
  if(path.includes('papa_catalog_language_filter'))return {mode:'auto',languageIds:['zh'],languages:[{id:'zh',name:'國語',active:true,sortOrder:0}]};
  if(path.includes('papa_notice_inbox'))return {rows:[],unread:{},preferences:{},topic:null};
  if(path.includes('papa_notice_sound_version'))return 'v1';
  if(path.includes('papa_notice_config?id=eq.player_sound'))return [{value:{data:'data:audio/mp4;base64,YQ=='}}];
  throw Error('unexpected database path: '+path);
 };
 vm.runInContext('actor=async()=>testActor;api=async(path,body)=>mockApi(path,body);'+(allowRead?'':'load=async()=>{throw Error("full snapshot was loaded")};'),context);
 const request=async body=>{
  const response=await handler({method:'POST',json:async()=>body});
  return {status:response.status,data:JSON.parse(await response.text())};
 };
 return {context,calls,request};
}

test('queue completion uses one room snapshot and the existing notification transaction without reading lyrics/full history',async()=>{
 const {context,calls,request}=edge(true);const now=new Date().toISOString();
 let state=mutate(empty(),{type:'song',data:{title:'Song',artist:'Artist',lyrics:'private source lyric'}},{role:'admin'},now);
 state=mutate(state,{type:'streamerDraw',data:{songId:state.songs[0].songId}},{role:'admin'},now);
 state=mutate(state,{type:'queue',data:{id:state.queue[0].id,operation:'stage',preparationMinutes:0}},{role:'admin'},now);
 const rows=stateEntries(state).map(row=>row.kind==='songs'?{...row,data:{...row.data,lyrics:undefined}}:row);
 const old=context.mockApi;context.testActor={role:'streamer_admin',streamer_id:'papa',spaceId:'space-001'};
 context.mockApi=async(path,body)=>{
  if(path.endsWith('papa_v2_scoped_read_snapshot_in_space')){calls.push({path,body});return {revision:7,rows};}
  if(path.endsWith('papa_room_operational_commit')){calls.push({path,body});assert.equal(body.requested_room,'papa');assert.ok(body.changes.every(r=>['queue','ledger','wishes'].includes(r.kind)));return 8;}
  return old(path,body);
 };
 const result=await request({op:'mutate',revision:7,streamer:'papa',action:{type:'queue',data:{id:state.queue[0].id,operation:'complete'}}});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.state.queue[0].status,'completed');
 assert.equal(calls.filter(c=>c.path.endsWith('papa_v2_scoped_read_snapshot_in_space')).length,1);
 assert.equal(calls.filter(c=>c.path.endsWith('papa_room_operational_commit')).length,1);
 assert.equal(calls.some(c=>c.path.endsWith('papa_v2_snapshot')),false);
 assert.equal(JSON.stringify(result.data).includes('private source lyric'),false);
});

test('version relation filters are bounded and ordinary streamers cannot query adoptable lyrics or another room',async()=>{
 const {context,calls,request}=edge(),original=context.mockApi;
 context.mockApi=async(path,body)=>{
  if(path.endsWith('papa_catalog_families_page_v3_in_space')){calls.push({path,body});return {rows:[],total:0,filters:{languages:['華語'],versionKinds:['cover']}};}
  if(path.endsWith('papa_catalog_variant_rooms_v3_in_space')){calls.push({path,body});return {items:[{streamerName:'怕怕'}],total:1};}
  return original(path,body);
 };
 context.testActor={role:'streamer_admin',streamer_id:'michelle'};
 const r=await request({op:'catalogReviewList',status:'families',streamer:'michelle',q:'Honey',language:'華語',versionKind:'cover',lyricsFilter:'proposals',limit:1000,offset:2});
 assert.equal(r.status,200);assert.equal(calls.at(-1).body.viewer_room,'michelle');assert.equal(calls.at(-1).body.page_limit,50);assert.equal(calls.at(-1).body.language_filter,'華語');assert.equal(calls.at(-1).body.version_filter,'cover');assert.equal(calls.at(-1).body.lyrics_filter,'all');assert.deepEqual(r.data.filters.languages,['華語']);
 assert.equal((await request({op:'catalogReviewList',status:'families',streamer:'papa'})).status,400);
 assert.equal((await request({op:'catalogRooms',variantId:'11111111-1111-4111-8111-111111111111'})).data.items[0].streamerName,'怕怕');
 assert.equal(calls.some(c=>c.path.includes('papa_v2_snapshot')),false);
});

test('public common-book classification uses one bounded RPC and no business snapshot',async()=>{
 const {context,calls,request}=edge(),old=context.mockApi;
 context.mockApi=async(path,body)=>{if(path.endsWith('papa_catalog_public_page_filtered_in_space')){calls.push({path,body});return {rows:[],total:0,filters:{languages:['英語'],performerTypes:['團體'],versionKinds:['cover']}};}return old(path,body);};
 const response=await request({op:'catalogSongbook',q:'Honey',language:'英語',performerType:'團體',versionKind:'cover',limit:1000,offset:12});
 assert.equal(response.status,200);assert.equal(calls.filter(c=>c.path.includes('public_page_filtered')).length,1);assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).body)),{query_text:'Honey',language_filter:'英語',performer_filter:'團體',version_filter:'cover',page_limit:20,page_offset:12,requested_space:'space-001'});
 assert.equal((await request({op:'catalogSongbook',language:'x'.repeat(101)})).status,200);assert.equal(calls.filter(c=>c.path.includes('public_page_filtered')).length,1);
});

test('issue inbox maps paginated rows and binds scope to the authenticated streamer',async()=>{
 const {request,calls,context}=edge(),original=context.mockApi;
 context.mockApi=async(path,body)=>{
  if(path.includes('papa_catalog_issue_page')){calls.push({path,body});return {rows:[{id:'report',description:'check'}],total:1,hasMore:false};}
  return original(path,body);
 };
 context.testActor={role:'streamer_admin',streamer_id:'papa'};
 const r=await request({op:'catalogIssues',streamer:'michelle',limit:10});
 assert.equal(r.status,200);assert.equal(r.data.items[0].id,'report');assert.equal(calls.at(-1).body.room_id,'papa');
 assert.equal((await request({op:'catalogVariantInfo',variantId:'11111111-1111-4111-8111-111111111111'})).status,400);
 context.testActor={role:'super_admin'};
 assert.equal((await request({op:'catalogIssues'})).status,200);assert.equal(calls.at(-1).body.room_id,null);
 context.testActor={role:'player',playerId:'P1'};
 const before=calls.length;assert.equal((await request({op:'catalogIssues'})).status,400);assert.equal(calls.length,before);
});

test('room lyric search returns only IDs without a full snapshot or cross-room results',async()=>{
 const {request,calls}=edge();
 const r=await request({op:'songSearchRoom',streamer:'papa',q:'某句歌詞',tags:['情歌'],limit:20,offset:0});
 assert.equal(r.status,200);
 assert.deepEqual(r.data.songIds,['local-song']);
 assert.equal(JSON.stringify(r.data).includes('歌詞'),false);
 const search=calls.find(c=>c.path.includes('papa_song_search_room'));
 assert.equal(search.body.room_id,'papa');
 assert.deepEqual(Array.from(search.body.tags),['情歌']);
 assert.equal(calls.some(c=>c.path.includes('papa_v2_snapshot')),false);
});

test('catalog governance requires president, complete optimistic locks and safe metadata',async()=>{
 const {request,calls,context}=edge(),variant='11111111-1111-4111-8111-111111111111',candidate='22222222-2222-4222-8222-222222222222';
 const body={op:'catalogGovernance',action:'update_variant',variantIds:[variant],metadata:{title:'更正歌名'},expectedVersions:{[variant]:'2026-10-04T01:00:00.123456+00:00'}};
 context.testActor={role:'streamer_admin',streamer_id:'papa'};
 assert.equal((await request(body)).status,400);assert.equal(calls.length,0);
 context.testActor={role:'super_admin'};
 assert.equal((await request({...body,expectedVersions:{}})).status,400);
 assert.equal((await request({...body,metadata:{lyrics:'secret'}})).status,400);
 assert.equal((await request({...body,action:'split_variant',candidateIds:[candidate]})).status,400);
 assert.equal((await request(body)).status,200);
 const write=calls.at(-1);assert.equal(write.body.actor_id,'president');
 assert.equal(write.body.expected_versions[variant],body.expectedVersions[variant],'preserve timestamp precision for database equality');
 assert.equal((await request({...body,action:'split_variant',candidateIds:[candidate],expectedSources:{[candidate]:'a'.repeat(32)}})).status,200);
 assert.equal(calls.at(-1).body.expected_sources[candidate],'a'.repeat(32));
 assert.equal((await request({...body,action:'merge_family',targetFamilyId:variant})).status,200);
 assert.equal(calls.at(-1).body.target_family,variant);
});

test('language preferences read publicly but can only be changed for an authorized room',async()=>{
 const {request,calls,context}=edge();
 assert.equal((await request({op:'catalogLanguageFilter',streamer:'papa'})).status,200);
 const body={op:'catalogLanguageFilterSave',streamer:'papa',mode:'custom',languageIds:['zh']};
 assert.equal((await request(body)).status,400);
 context.testActor={role:'streamer_admin',streamer_id:'papa'};
 assert.equal((await request({...body,streamer:'michelle'})).status,400);
 assert.equal((await request({...body,languageIds:['zh','zh']})).status,400);
 assert.equal((await request(body)).status,200);
 assert.equal(calls.at(-1).body.room_id,'papa');
 assert.equal(calls.at(-1).body.actor_id,'streamer:papa');
 await request({op:'songSearchRoom',streamer:'papa',q:'歌詞',language:'國語'});
 assert.equal(calls.at(-1).body.language_name,'華語');
});

test('common metadata projection never mutates original song data or private fields',()=>{
 const {context}=edge();
 context.fixture={songs:[{songId:'S1',streamer_id:'papa',title:'原名稱',artist:'原歌手',tags:['本地'],lyrics:'私有歌詞'}]};
 context.common=[{songId:'S1',title:'正式名稱',artist:'正式歌手',cat:'國語',lyrics:'不應覆蓋',privateNote:'不應出現'}];
 const projected=vm.runInContext('catalogMetadataView(fixture,common)',context);
 assert.equal(projected.songs[0].title,'正式名稱');assert.equal(context.fixture.songs[0].title,'原名稱');
 assert.equal(projected.songs[0].lyrics,'私有歌詞');assert.equal(projected.songs[0].privateNote,undefined);
 context.action={type:'song',data:{songId:'S1',title:'正式名稱',artist:'正式歌手',cat:'國語',tags:['新標籤']}};
 const saved=vm.runInContext('catalogPreserveSource(action,fixture,"papa",common)',context);
 assert.equal(saved.data.title,'原名稱');assert.equal(saved.data.artist,'原歌手');assert.equal('cat' in saved.data,false);
 assert.deepEqual(saved.data.tags,['新標籤']);assert.equal(context.action.data.title,'正式名稱');
 context.action.data.title='主播更改歌名';
 assert.equal(vm.runInContext('catalogPreserveSource(action,fixture,"papa",common)',context).data.title,'主播更改歌名');
});

test('streamer catalog access is room-bound; players cannot inspect shared management or lyrics',async()=>{
 const {request,calls,context}=edge();
 context.testActor={role:'streamer_admin',streamer_id:'papa'};
 const ok=await request({op:'catalogSearch',streamer:'papa',q:'公開',limit:20});
 assert.equal(ok.status,200);assert.equal(ok.data.items[0].variantId,'variant-id');
 const count=calls.length;
 assert.equal((await request({op:'catalogSearch',streamer:'michelle',q:'公開'})).status,400);
 assert.equal(calls.length,count+1,'cross-room lookup reads only shared room metadata before denial');
 const lyrics=await request({op:'catalogLyrics',streamer:'papa',streamerSongId:'local-song'});
 assert.equal(lyrics.status,200);assert.equal(lyrics.data.body,'只供主播看的完整歌詞');
 assert.equal(lyrics.data.variantId,'11111111-1111-4111-8111-111111111111');
 assert.equal((await request({op:'catalogLyrics',streamer:'papa',streamerSongId:'local-song',includeHistory:true})).status,400);
 context.testActor={role:'player',playerId:'P1'};
 assert.equal((await request({op:'catalogSearch',streamer:'papa',q:'公開'})).status,400);
 assert.equal((await request({op:'catalogLyrics',streamer:'papa',streamerSongId:'local-song'})).status,400);
 assert.equal(calls.some(c=>c.path.includes('papa_v2_snapshot')),false);
});

test('room lyric response uses the validated database link without a redundant link fetch',async()=>{
 const {request,calls,context}=edge(),original=context.mockApi;
 context.testActor={role:'super_admin'};
 context.mockApi=async(path,body)=>path.includes('papa_catalog_get_lyrics')?{body:'原有歌詞',mode:'own',variantId:null}:original(path,body);
 const r=await request({op:'catalogLyrics',streamer:'papa',streamerSongId:'local-song',variantId:'11111111-1111-4111-8111-111111111111'});
 assert.equal(r.status,200);assert.equal(r.data.linked,false);assert.equal(r.data.variantId,null);
 assert.equal(calls.some(c=>c.path.includes('papa_catalog_song_links?')),false);
 assert.equal((await request({op:'catalogLyrics',streamer:'papa',streamerSongId:'local-song',includeHistory:true})).status,400);
});

test('notification fallback keeps full audio out of repeated replies and managers skip it',async()=>{
 const {request,calls,context}=edge();
 context.testActor={role:'player',playerId:'P1'};
 const first=await request({op:'notifications',streamer:'papa',page:0});
 assert.equal(first.status,200);assert.equal(first.data.playerSoundVersion,'v1');
 assert.match(first.data.playerSound,/^data:audio/);
 const cached=await request({op:'notifications',streamer:'papa',page:0,soundVersion:'v1'});
 assert.equal(cached.status,200);assert.equal('playerSound' in cached.data,false);
 assert.equal(calls.filter(c=>c.path.includes('papa_notice_config?id=eq.player_sound')).length,1);
 context.testActor={role:'super_admin'};
 const manager=await request({op:'notifications',streamer:'papa',page:0});
 assert.equal(manager.status,200);assert.equal(manager.data.playerSoundVersion,null);
 assert.equal(calls.filter(c=>c.path.includes('papa_notice_sound_version')).length,2);
 assert.equal(calls.some(c=>c.path.includes('papa_v2_snapshot')),false);
});

test('unchanged read uses small revision and room metadata, while forced read keeps full path',async()=>{
 const {request,calls,context}=edge();
 const same=await request({op:'read',streamer:'papa',revision:7,signatures:{songs:'known'}});
 assert.equal(same.status,200);assert.deepEqual(Object.keys(same.data.state),[]);
 assert.equal(calls.some(c=>c.path.includes('papa_v2_snapshot')),false);
 assert.equal((await request({op:'read',streamer:'papa',revision:-1,signatures:{songs:'known'}})).status,400,'forced refresh must continue to the full read path');
 context.testActor={role:'streamer_admin',streamer_id:'michelle'};
 assert.equal((await request({op:'read',streamer:'papa',revision:7,signatures:{songs:'known'}})).status,400,'cached reads still enforce streamer scope');
});

test('forced ordinary read requests only its room from the scoped snapshot RPC',async()=>{
 const {request,calls}=edge(true);
 const result=await request({op:'read',streamer:'michelle',revision:-1});
 assert.equal(result.status,200,JSON.stringify(result.data));
 const read=calls.find(c=>c.path.includes('papa_v2_scoped_read_snapshot'));
 assert.equal(read.body.requested_room,'michelle');
 assert.equal(calls.some(c=>c.path.includes('papa_v2_snapshot')),false);
});

test('catalog singer relationships use server-resolved Space and cannot accept caller-selected scope',async()=>{
 const {context,calls,request}=edge(),old=context.mockApi;
 context.mockApi=async(path,body)=>{
  if(path.includes('papa_streamer_directory')){calls.push({path,body});return [{id:'papa',slug:'papa',active:true,spaceId:'space-001'},{id:'other',slug:'other',active:true,spaceId:'space-002'}];}
  if(path.includes('papa_catalog_public_page_filtered_in_space')||path.includes('papa_catalog_family_singers_in_space')||path.includes('papa_catalog_variant_rooms_v3_in_space')||path.includes('papa_catalog_families_page_v3_in_space')){calls.push({path,body});return {rows:[],items:[],total:0,hasMore:false};}
  return old(path,body);
 };
 const family='11111111-1111-4111-8111-111111111111';
 context.testActor={role:'player',playerId:'P1',spaceId:'space-001'};
 let result=await request({op:'catalogSongbook',streamer:'papa',spaceId:'space-002',requested_space:'space-002'});
 assert.equal(result.status,200);assert.equal(calls.at(-1).body.requested_space,'space-001');
 const before=calls.filter(c=>c.path.includes('papa_catalog_public_page_filtered_in_space')).length;
 assert.equal((await request({op:'catalogSongbook',streamer:'other'})).status,400);
 assert.equal(calls.filter(c=>c.path.includes('papa_catalog_public_page_filtered_in_space')).length,before);
 context.testActor=null;assert.equal((await request({op:'catalogSongbook',streamer:'other'})).status,400);
 context.testActor={role:'streamer_admin',streamer_id:'papa',spaceId:'space-001'};
 for(const body of [{op:'catalogFamilySingers',familyId:family},{op:'catalogRooms',variantId:family},{op:'catalogReviewList',status:'families'}]){
  result=await request({...body,spaceId:'space-002'});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(calls.at(-1).body.requested_space,'space-001');
 }
 context.testActor={role:'super_admin',accountId:'president'};
 assert.equal((await request({op:'catalogRooms',variantId:family})).status,200);assert.equal(calls.at(-1).body.requested_space,null,'only global president review may request all Spaces');
 assert.equal((await request({op:'catalogSongbook',streamer:'other'})).status,200);assert.equal(calls.at(-1).body.requested_space,'space-002');
 assert.equal(calls.some(c=>c.path.endsWith('papa_v2_snapshot')),false);
});

test('communication directory binds server Space and lightweight manager paths never load business snapshots',async()=>{
 const {context,calls,request}=edge(),original=context.mockApi;
 context.mockApi=async(path,body)=>{
  if(path.endsWith('papa_manager_login')){calls.push({path,body});return true;}
  if(path.endsWith('papa_bind_verified_legacy_session')){calls.push({path,body});return {role:'streamer_admin',streamerId:'papa'};}
  if(path.endsWith('papa_manage_streamer_login')){calls.push({path,body});return {ok:true};}
  return original(path,body);
 };
 context.allowedFixtureSpace='space-002';
 await vm.runInContext('loadCommunicationState(allowedFixtureSpace)',context);
 assert.equal(calls.at(-1).body.chosen_space,'space-002');calls.length=0;
 const login=await request({op:'streamerLogin',streamer:'papa',password:'fixture-only',spaceId:'space-002'});
 assert.equal(login.status,200,JSON.stringify(login.data));
 assert.equal(calls.find(c=>c.path.endsWith('papa_streamer_directory_in_space')).body.chosen_space,'space-001');
 context.testActor={role:'super_admin'};
 assert.equal((await request({op:'setStreamerAccount',streamer:'papa',password:'fixture-only',enabled:true})).status,200);
 let uploads=0;context.atob=atob;context.fetch=async()=>{uploads++;return new Response('',{status:200});};
 context.testActor={role:'streamer_admin',streamer_id:'papa',spaceId:'space-001'};
 assert.equal((await request({op:'upload',streamer:'michelle',mime:'image/webp',image:'YQ=='})).status,400);
 assert.equal(uploads,0,'cross-room upload never writes storage');
 assert.equal((await request({op:'upload',streamer:'papa',mime:'image/webp',image:'YQ=='})).status,200);assert.equal(uploads,1);
 context.testActor={role:'player',playerId:'P1',spaceId:'space-002'};
 const count=calls.length;
 assert.equal((await request({op:'notifications',streamer:'other'})).status,400);
 assert.equal(calls.length,count,'Space 002 barrier remains before communication access');
 assert.equal(calls.some(c=>c.path.includes('papa_v2_snapshot')),false);
});

test('catalog audit actor is the verified Account and Space, never caller-provided identity',async()=>{
 const {context,calls,request}=edge();
 context.testActor={role:'streamer_admin',streamer_id:'papa',spaceId:'space-001',accountId:'22222222-2222-4222-8222-222222222222'};
 const result=await request({op:'catalogLanguageFilterSave',streamer:'papa',mode:'auto',languageIds:[],actor_id:'president',accountId:'forged',spaceId:'space-002'});
 assert.equal(result.status,200,JSON.stringify(result.data));
 const key=calls.at(-1).body.actor_id;assert.ok(key.startsWith('verified:'));
 assert.deepEqual(JSON.parse(key.slice(9)),{account_id:context.testActor.accountId,role:'streamer_admin',space_id:'space-001',actor_streamer_id:'papa',player_id:null});
});

test('legacy cross-room song search uses a bounded authorized-Space RPC instead of a platform snapshot',async()=>{
 const {context,calls,request}=edge(),old=context.mockApi;
 context.mockApi=async(path,body)=>{if(path.endsWith('papa_song_search_in_space')){calls.push({path,body});return [{songId:'S1',title:'Honey',artist:'Artist',streamer:'怕怕',slug:'papa'}];}return old(path,body);};
 context.testActor={role:'player',playerId:'P1',spaceId:'space-001'};
 const result=await request({op:'songSearch',streamer:'papa',query:'Honey',spaceId:'space-002'});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.songs[0].songId,'S1');
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).body)),{query_text:'Honey',requested_space:'space-001',page_limit:100});
 assert.equal(calls.some(c=>c.path.includes('snapshot')),false);
 const count=calls.filter(c=>c.path.endsWith('papa_song_search_in_space')).length;
 await request({op:'songSearch',query:''});assert.equal(calls.filter(c=>c.path.endsWith('papa_song_search_in_space')).length,count);
 assert.equal((await request({op:'songSearch',query:'x'.repeat(101)})).status,400);
});

test('song editing and learned wishes use one guarded room snapshot and never hydrate unrelated lyric bodies',async()=>{
 const {context,calls,request}=edge(true),now=new Date().toISOString();
 let state=mutate(empty(),{type:'song',data:{title:'Song',artist:'Artist',lyrics:'original-private-body',tags:['甜歌']}},{role:'admin'},now);
 const id=state.songs[0].songId;state.wishes=[{id:'W1',streamer_id:'papa',title:'Learned',artist:'Artist',status:'收到',playerId:'P1'}];
 const original=context.mockApi;context.testActor={role:'streamer_admin',streamer_id:'papa',spaceId:'space-001'};
 context.mockApi=async(path,body)=>{
  if(path.endsWith('papa_v2_room_write_snapshot_in_space')){calls.push({path,body});return {revision:7,rows:stateEntries(state).map(row=>row.kind==='songs'&&!body.selected_song_ids.includes(row.id)?{...row,data:{...row.data,lyrics:undefined}}:row)};}
  if(path.endsWith('papa_room_admin_commit')){calls.push({path,body});assert.equal(body.requested_room,'papa');assert.equal(body.actor_context.roomWriteScoped,true);return 8;}
  return original(path,body);
 };
 for(const action of [{type:'song',data:{songId:id,title:'Edited',artist:'Artist',tags:['甜歌']}},{type:'songsBulk',data:{songIds:[id],new:true}},{type:'wishAdmin',data:{id:'W1',status:'已學會',addSong:true}}]){
  const from=calls.length,result=await request({op:'mutate',revision:7,streamer:'papa',action});
  assert.equal(result.status,200,JSON.stringify(result.data));
  const current=calls.slice(from),snapshot=current.find(c=>c.path.endsWith('papa_v2_room_write_snapshot_in_space'));
  assert.deepEqual(Array.from(snapshot.body.selected_song_ids),action.type==='song'?[id]:[]);
  assert.equal(current.filter(c=>c.path.endsWith('papa_v2_room_write_snapshot_in_space')).length,1);
  assert.equal(current.filter(c=>c.path.endsWith('papa_room_admin_commit')).length,1);
  assert.equal(current.some(c=>c.path.endsWith('papa_v2_snapshot')),false);
  assert.equal(JSON.stringify(result.data).includes('original-private-body'),false);
  if(action.type==='song')assert.equal(current.find(c=>c.path.endsWith('papa_room_admin_commit')).body.changes.find(c=>c.kind==='songs').data.lyrics,'original-private-body');
  if(action.type==='wishAdmin')assert.equal(result.data.state.songs.some(song=>song.title==='Learned'),true);
 }
});
