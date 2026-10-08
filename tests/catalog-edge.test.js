import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';

function edge(){
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
 vm.runInContext('actor=async()=>testActor;api=async(path,body)=>mockApi(path,body);load=async()=>{throw Error("full snapshot was loaded")};',context);
 const request=async body=>{
  const response=await handler({method:'POST',json:async()=>body});
  return {status:response.status,data:JSON.parse(await response.text())};
 };
 return {context,calls,request};
}

test('version relation filters are bounded and ordinary streamers cannot query adoptable lyrics or another room',async()=>{
 const {context,calls,request}=edge(),original=context.mockApi;
 context.mockApi=async(path,body)=>{
  if(path.endsWith('papa_catalog_families_page_v3')){calls.push({path,body});return {rows:[],total:0,filters:{languages:['華語'],versionKinds:['cover']}};}
  if(path.endsWith('papa_catalog_variant_rooms_v3')){calls.push({path,body});return {items:[{streamerName:'怕怕'}],total:1};}
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
 context.mockApi=async(path,body)=>{if(path.endsWith('papa_catalog_public_page_filtered')){calls.push({path,body});return {rows:[],total:0,filters:{languages:['英語'],performerTypes:['團體'],versionKinds:['cover']}};}return old(path,body);};
 const response=await request({op:'catalogSongbook',q:'Honey',language:'英語',performerType:'團體',versionKind:'cover',limit:1000,offset:12});
 assert.equal(response.status,200);assert.equal(calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)),{query_text:'Honey',language_filter:'英語',performer_filter:'團體',version_filter:'cover',page_limit:20,page_offset:12});
 assert.equal((await request({op:'catalogSongbook',language:'x'.repeat(101)})).status,200);assert.equal(calls.length,1);
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

test('manager metadata and upload paths never download a business snapshot',async()=>{
 const {context,calls,request}=edge(),original=context.mockApi;
 context.mockApi=async(path,body)=>{if(path.endsWith('papa_manager_login')){calls.push({path,body});return true;}if(path.endsWith('papa_manage_streamer_login')){calls.push({path,body});return {ok:true};}return original(path,body);};
 assert.equal((await request({op:'streamerLogin',streamer:'papa',password:'fixture-only'})).status,200);
 context.testActor={role:'super_admin'};
 assert.equal((await request({op:'setStreamerAccount',streamer:'papa',password:'fixture-only',enabled:true})).status,200);
 let uploads=0;context.atob=atob;context.fetch=async()=>{uploads++;return new Response('',{status:200});};
 context.testActor={role:'streamer_admin',streamer_id:'papa'};
 assert.equal((await request({op:'upload',streamer:'michelle',mime:'image/webp',image:'YQ=='})).status,400);assert.equal(uploads,0);
 assert.equal((await request({op:'upload',streamer:'papa',mime:'image/webp',image:'YQ=='})).status,200);assert.equal(uploads,1);
 assert.equal(calls.filter(c=>c.path.endsWith('papa_streamer_directory')).length,4);
 assert.equal(calls.some(c=>c.path.includes('papa_v2_snapshot')),false);
});
