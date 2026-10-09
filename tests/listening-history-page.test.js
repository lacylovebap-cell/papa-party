import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {listenedSongs} from '../src/listening-history.js';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const nativeSpace='space-history',nativeRoom='history-native';
const publicKeys=['artist','listenedCount','requestable','songId','title'];
async function fixture(t){
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql','202609280001_manager_passwords.sql','202609250002_private_chat.sql','202609260001_board.sql','202609260002_board_integrity.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{schemaVersion:3,streamers:[{id:'papa',slug:'papa',active:true},{id:'michelle',slug:'michelle',active:true}],streamerSettings:{papa:{},michelle:{}}}]);
 for(const id of ['P1','P2'])await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,{playerId:id,name:'Legacy '+id,ids:[id+'-login'],names:[],password:'secret password',note:'secret profile note'}]);
 for(const name of fs.readdirSync('supabase/migrations').filter(file=>/^2026100100\d\d_/.test(file)||/^20261005000[123]_/.test(file)||/^2026100800(?:0[1-9]|10)_/.test(file)).sort())await db.exec(migration(name));
 for(const name of fs.readdirSync('supabase/migrations').filter(file=>/^2026100700\d\d_/.test(file)||/^20261008001[1-4]_/.test(file)||/^2026100900\d\d_/.test(file)).sort())await db.exec(migration(name));
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const player=await account(),other=await account(),unbound=await account(),president=await account(),legacyManager=await account(),nativeManager=await account();
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[president]);
 await q("insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,'P1'),($2,'P2')",[player,other]);
 const members={};
 for(const [id,subject] of [['P1',player],['P2',other],['unbound',unbound]])members['legacy-'+id]=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player') returning id",[subject]))[0].id;
 await q("insert into papa_spaces(id,slug,display_name) values($1,'history','History Space'),('space-history-foreign','history-foreign','Foreign')",[nativeSpace]);
 for(const [id,space] of [[nativeRoom,nativeSpace],['history-other',nativeSpace],['history-foreign','space-history-foreign']])await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,space]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [nativeRoom,'history-other','history-foreign']){meta.streamers.push({id,slug:id,active:true});meta.streamerSettings[id]={};}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 for(const [id,subject,space] of [['P1',player,nativeSpace],['P2',other,nativeSpace],['PF',unbound,'space-history-foreign']]){
  const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[subject,space]))[0].id;members[space+'-'+id]=member;
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',[space,id,subject,member,{playerId:id,name:'Native '+id,ids:[],names:[],note:'secret native profile note'}]);
 }
 for(const [space,room,subject,key] of [['space-001','papa',legacyManager,'legacy-manager'],[nativeSpace,nativeRoom,nativeManager,'native-manager']])members[key]=(await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,$2,'streamer_admin',$3) returning id",[subject,space,room]))[0].id;
 const family=(await q("insert into papa_catalog_families(title) values('History Family') returning id"))[0].id;
 const variant=(await q("insert into papa_catalog_variants(family_id,title,artist,language_id,performer_type_id,version_label) values($1,'Current Shared Title','Current Shared Artist','mandarin','female','Live') returning id",[family]))[0].id;
 const inactive=(await q("insert into papa_catalog_variants(family_id,title,artist,language_id,performer_type_id,active) values($1,'Inactive Shared Title','Inactive Shared Artist','mandarin','female',false) returning id",[family]))[0].id;
 await q("insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id) values($1,1,'secret shared lyric',true,'president')",[variant]);
 const song=async(room,space,suffix,extra={})=>{
  const id=room+'-'+suffix,data={songId:id,streamer_id:room,title:'Current '+suffix,artist:'Current Artist',tags:[],creditCost:suffix==='long'?3:1,hidden:false,lyrics:'secret source lyric',privateNotes:'secret source note',playAdjustment:99,...extra};
  await q("insert into papa_v2_entities(kind,id,space_id,data) values('songs',$1,$2,$3)",[id,space,data]);return data;
 };
 for(const [room,space] of [['papa','space-001'],[nativeRoom,nativeSpace],['michelle','space-001'],['history-other',nativeSpace]])for(const suffix of ['a','b','long','shared','stale','inactive','hidden','deleted','removed','unheard']){
  const data=await song(room,space,suffix,{hidden:suffix==='hidden',deleted:suffix==='deleted'});
  if(['shared','stale','inactive','hidden'].includes(suffix))await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',[room,data.songId,suffix==='inactive'?inactive:variant,suffix==='stale'?{...data,title:'stale hash title'}:data]);
 }
 const actor=(room='papa',space='space-001',subject=player,id='P1')=>({role:'player',account_id:subject,player_id:id,space_id:space,streamer_id:room});
 const manager=(room='papa',space='space-001',subject=legacyManager)=>({role:'streamer_admin',account_id:subject,actor_streamer_id:room,space_id:space,streamer_id:room});
 const superAdmin=(room='papa',space='space-001')=>({role:'super_admin',account_id:president,space_id:space,streamer_id:room});
 const page=(context=actor(),id='P1',limit=20,offset=0)=>rpc('papa_listening_history_page',[context.space_id,context.streamer_id,id,context,limit,offset]);
 const queue=async(room,space,id,suffix,extra={})=>{
  const data={id,playerId:'P1',songId:room+'-'+suffix,title:'Snapshot '+suffix,artist:'Snapshot Artist',kind:'saved',status:'completed',streamer_id:room,completedAt:'2026-10-08T12:00:00Z',note:'secret queue note',...extra};
  await q("insert into papa_v2_entities(kind,id,space_id,data) values('queue',$1,$2,$3)",[id,space,data]);return data;
 };
 const scoped=async(room,space)=>({schemaVersion:3,currentStreamer:{id:room},songs:(await q("select data from papa_v2_entities where kind='songs' and space_id=$1 and data->>'streamer_id'=$2 order by id",[space,room])).map(row=>row.data),queue:(await q("select data from papa_v2_entities where kind='queue' and space_id=$1 and data->>'streamer_id'=$2 order by id",[space,room])).map(row=>row.data)});
 const source=async()=>{
  const tables=['papa_v2_entities','papa_accounts','papa_space_memberships','papa_space_player_profiles','papa_catalog_song_links','papa_catalog_variants','papa_catalog_families','papa_catalog_lyric_revisions','papa_catalog_private_notes','papa_catalog_lyric_selections','papa_events','papa_notifications','papa_push_jobs','papa_song_favorites'];
  const data={snapshot:await rpc('papa_v2_snapshot')};
  for(const table of tables)data[table]=await q('select to_jsonb(item) row from '+table+' item order by to_jsonb(item)::text');
  return data;
 };
 return {db,q,rpc,actor,manager,superAdmin,page,queue,scoped,source,player,other,unbound,president,legacyManager,nativeManager,members,variant,family};
}

for(const [space,room] of [['space-001','papa'],[nativeSpace,nativeRoom]])test(room+' history aggregates before paging with helper parity across venues and original completion rules',async t=>{
 const f=await fixture(t),{queue,page,actor,scoped,source}=f,context=actor(room,space),a=room+'-a',b=room+'-b',long=room+'-long';
 await queue(room,space,room+'-twice','a',{venue:'shengma',creditCost:1,items:[{songId:a,performances:2}]});
 await queue(room,space,room+'-pair','a',{venue:'radio',consumed_storage_pool:'radio',creditCost:1,items:[{songId:a,performances:1},{songId:b,performances:1}]});
 await queue(room,space,room+'-repeated','b',{venue:'radio',consumed_storage_pool:'shengma',items:[{songId:b,performances:1},{songId:b,performances:2}]});
 await queue(room,space,room+'-legacy-a','a');
 await queue(room,space,room+'-long','long',{creditCost:3,items:[{songId:long,performances:1}]});
 await queue(room,space,room+'-legacy-long','long',{items:null});await queue(room,space,room+'-legacy-nonarray','long',{items:'legacy'});
 await queue(room,space,room+'-empty','long',{items:[]});
 await queue(room,space,room+'-malformed','long',{items:[{songId:long,performances:0},{songId:long,performances:-1},{songId:long,performances:1.5},{songId:long,performances:'2'},{songId:long,performances:9007199254740992},{songId:5,performances:8}]});
 for(const [id,extra] of [['waiting',{status:'waiting'}],['pending',{status:'pending'}],['cancelled',{status:'cancelled'}],['stored',{status:'stored'}],['test',{test:true}],['self-provided',{selfProvided:true}],['self',{kind:'self',selfProvided:false}],['other-player',{playerId:'P2',items:[{songId:a,performances:100}]}]])await queue(room,space,room+'-'+id,'a',extra);
 await queue(room==='papa'?'michelle':'history-other',space,room+'-foreign-room','a',{items:[{songId:a,performances:999}]});
 const before=await source(),expected=listenedSongs(await scoped(room,space),'P1'),result=await page(context);
 assert.deepEqual(result.rows,expected);assert.deepEqual(result.rows.map(row=>[row.songId,row.listenedCount]),[[a,4],[b,4],[long,3]]);
 assert.equal(result.total,3);assert.equal(result.hasMore,false);
 const pages=await Promise.all([0,1,2,3].map(offset=>page(context,'P1',1,offset)));
 assert.deepEqual(pages.slice(0,3).map(result=>result.rows[0].songId),[a,b,long]);
 for(const [index,result] of pages.entries()){assert.equal(result.total,3);assert.equal(result.pageLimit,1);assert.equal(result.pageOffset,index);assert.equal(result.hasMore,index<2);}
 assert.deepEqual(pages[3].rows,[]);assert.deepEqual((await page(actor(room,space,f.other,'P2'),'P2')).rows.map(row=>[row.songId,row.listenedCount]),[[a,100]]);
 for(const row of result.rows)assert.deepEqual(Object.keys(row).sort(),publicKeys);
 assert.deepEqual(await source(),before,'all page reads preserve snapshots/revision/accounts/quota/favorites/audit/notices/lyrics');
});

test('history prefers valid current shared metadata and retains private-safe hidden/deleted snapshots deterministically',async t=>{
 const {q,page,queue,source,variant,family}=await fixture(t);
 for(const suffix of ['shared','stale','inactive','hidden','deleted'])await queue('papa','space-001','queue-'+suffix,suffix);
 await queue('papa','space-001','removed-old','removed',{completedAt:'2026-10-07T12:00:00Z',title:'Old Removed Snapshot',artist:'Old Snapshot Artist'});
 await queue('papa','space-001','removed-latest','removed',{history_effective_at:'bad date',completedAt:'2026-10-09T12:00:00+08:00',title:'Latest Removed Snapshot',artist:'Latest Snapshot Artist'});
 await queue('papa','space-001','removed-pair','a',{completedAt:'2026-10-08T00:00:00Z',items:[{songId:'pair-deleted',performances:1},{songId:'missing-title',performances:1,title:'',artist:''}]});
 await q("delete from papa_v2_entities where kind='songs' and id='papa-removed'");
 await q("insert into papa_song_favorites(account_id,space_id,player_id,streamer_id,song_id) select account_id,'space-001','P1','papa','papa-unheard' from papa_account_legacy_players where legacy_player_id='P1'");
 const before=await source(),result=await page(),byId=new Map(result.rows.map(row=>[row.songId,row]));
 assert.equal(byId.get('papa-shared').title,'Current Shared Title');assert.equal(byId.get('papa-shared').artist,'Current Shared Artist');
 assert.equal(byId.get('papa-stale').title,'Current stale');assert.equal(byId.get('papa-inactive').title,'Current inactive');
 assert.equal(byId.get('papa-hidden').requestable,false);assert.equal(byId.get('papa-deleted').requestable,false);
 assert.deepEqual(byId.get('papa-removed'),{songId:'papa-removed',title:'Latest Removed Snapshot',artist:'Latest Snapshot Artist',listenedCount:2,requestable:false});
 assert.equal(byId.get('pair-deleted').title,'歌曲');assert.equal(byId.get('missing-title').title,'歌曲');assert.equal(byId.get('pair-deleted').requestable,false);
 assert.equal(byId.has('papa-unheard'),false,'favorites never infer listening');
 for(const row of result.rows)assert.deepEqual(Object.keys(row).sort(),publicKeys);
 assert.doesNotMatch(JSON.stringify(result),/secret|lyrics|private|account|playerId|queueId|source_hash|sourceHash/i);
 assert.deepEqual(await source(),before);
 await q('update papa_catalog_variants set active=false where id=$1',[variant]);assert.equal((await page()).rows.find(row=>row.songId==='papa-shared').title,'Current shared');await q('update papa_catalog_variants set active=true where id=$1',[variant]);
 await q('update papa_catalog_families set active=false where id=$1',[family]);assert.equal((await page()).rows.find(row=>row.songId==='papa-shared').title,'Current shared');
});

test('history authorizes only verified own players and current managers/president with bounded pages and denied browser access',async t=>{
 const f=await fixture(t),{db,q,rpc,actor,manager,superAdmin,page,queue,source,player,other,unbound,president,legacyManager,nativeManager,members}=f;
 await queue('papa','space-001','legacy-own','a');await queue(nativeRoom,nativeSpace,'native-own','a');
 const before=await source();
 for(const context of [actor(),actor(nativeRoom,nativeSpace),manager(),manager(nativeRoom,nativeSpace,nativeManager),superAdmin(),superAdmin(nativeRoom,nativeSpace)])assert.equal((await page(context)).total,1);
 assert.deepEqual(await source(),before);
 for(const context of [null,{}, {...actor(),role:'guest'},{...actor(),account_id:null},{...actor(),account_id:'bad-uuid'}, {...actor(),account_id:other},{...actor(),account_id:unbound},{...actor(),player_id:'P2'}, {...actor(),space_id:nativeSpace},{...actor(nativeRoom,nativeSpace),streamer_id:'papa'},{...manager(),actor_streamer_id:'michelle'},{...manager(),account_id:player},{...superAdmin(),account_id:player}]){
  await assert.rejects(rpc('papa_listening_history_page',[context?.space_id||'space-001',context?.streamer_id||'papa','P1',context,20,0]),/LISTENING_HISTORY|SONG_FAVORITES|ROOM_WRITE/);
 }
 await assert.rejects(page(actor(),'P2'),/LISTENING_HISTORY_ACTOR_INVALID/);await assert.rejects(page(manager(),'unknown'),/LISTENING_HISTORY_PLAYER_INVALID/);
 await assert.rejects(page(manager(nativeRoom,nativeSpace,nativeManager),'PF'),/LISTENING_HISTORY_PLAYER_INVALID/);
 for(const [limit,offset] of [[0,0],[51,0],[null,0],[20,-1],[20,10000001],[20,null]])await assert.rejects(page(actor(),'P1',limit,offset),/LISTENING_HISTORY_PAGE_INVALID/);
 assert.deepEqual((await page(actor(),'P1',50,10000000)).rows,[]);
 for(const subject of [player,legacyManager,nativeManager,president]){
  await q('update papa_accounts set disabled_at=now() where id=$1',[subject]);
  await assert.rejects(page(subject===player?actor():subject===legacyManager?manager():subject===nativeManager?manager(nativeRoom,nativeSpace,nativeManager):superAdmin()),/ACTOR_INVALID/);
  await q('update papa_accounts set disabled_at=null where id=$1',[subject]);
 }
 for(const [member,context] of [[members['legacy-P1'],actor()],[members[nativeSpace+'-P1'],actor(nativeRoom,nativeSpace)],[members['legacy-manager'],manager()],[members['native-manager'],manager(nativeRoom,nativeSpace,nativeManager)]]){
  await q("update papa_space_memberships set status='suspended' where id=$1",[member]);await assert.rejects(page(context),/ACTOR_INVALID/);await q("update papa_space_memberships set status='active' where id=$1",[member]);
 }
 await q("update papa_spaces set status='suspended' where id=$1",[nativeSpace]);await assert.rejects(page(actor(nativeRoom,nativeSpace)),/SCOPE_INVALID/);await q("update papa_spaces set status='active' where id=$1",[nativeSpace]);
 await q("delete from papa_space_player_profiles where space_id=$1 and player_id='P1'",[nativeSpace]);await assert.rejects(page(manager(nativeRoom,nativeSpace,nativeManager)),/PLAYER_INVALID/);
 const browserBefore=await source();
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(page(),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal((await page()).total,1);await db.exec('reset role');assert.deepEqual(await source(),browserBefore);
});
