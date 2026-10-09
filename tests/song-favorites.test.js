import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const favoriteMigration='202610090009_song_favorites.sql',nativeSpace='space-favorites',nativeRoom='favorites-native';
const songKeys=new Set(['id','songId','streamer_id','title','artist','cat','artistType','tags','new','murmur','creditCost','shortMode','pairSongIds','hidden',
 'version','catalogVariantId','hasLyrics','lyricsMode','hasSharedLyrics','hasCustomLyrics','favorite','favoritedAt']);
async function fixture(t){
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 // Use the established full-backup fixture's real migration stack so the
 // privileged backup augmentation is exercised against every original table.
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql',
  '202609280001_manager_passwords.sql','202609250002_private_chat.sql','202609260001_board.sql','202609260002_board_integrity.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{schemaVersion:3,streamers:[
  {id:'papa',slug:'papa',display_name:'Legacy Room',active:true},{id:'michelle',slug:'michelle',display_name:'Other Room',active:true}],streamerSettings:{papa:{},michelle:{}}}]);
 for(const [id,name] of [['P1','Legacy Player'],['P2','Other Player']])await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",
  [id,{playerId:id,name,ids:[id+'-login'],names:[name],password:'secret legacy credential',note:'secret private player note'}]);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)||/^2026100800(?:0[1-9]|10)_/.test(f)).sort())await db.exec(migration(file));
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100700\d\d_/.test(f)||/^20261008001[1-4]_/.test(f)||/^20261009000[1-8]_/.test(f)).sort())await db.exec(migration(file));
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const player=await account(),other=await account(),president=await account(),unbound=await account();
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[president]);
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,'P1'),($2,'P2')",[player,other]);
 const members={};
 for(const [id,subject] of [['P1',player],['P2',other],['unbound',unbound]])members['legacy-'+id]=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','player') returning id",[subject]))[0].id;
 await q("insert into papa_spaces(id,slug,display_name) values($1,'favorites','Favorite Space'),('space-favorites-foreign','favorite-foreign','Foreign')",[nativeSpace]);
 for(const [id,space] of [[nativeRoom,nativeSpace],['favorites-other',nativeSpace],['favorites-foreign','space-favorites-foreign']])await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,space]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [nativeRoom,'favorites-other','favorites-foreign']){meta.streamers.push({id,slug:id,display_name:id,active:true});meta.streamerSettings[id]={};}
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 for(const [id,subject,name,space] of [['P1',player,'Native Player',nativeSpace],['P2',other,'Other Native Player',nativeSpace],['PF',unbound,'Foreign Player','space-favorites-foreign']]){
  const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[subject,space]))[0].id;members[space+'-'+id]=member;
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',[space,id,subject,member,
   {playerId:id,name,ids:[id+'-native'],names:[],note:'secret native profile note'}]);
 }
 const family=(await q("insert into papa_catalog_families(title) values('Favorite Family') returning id"))[0].id;
 const variant=(await q("insert into papa_catalog_variants(family_id,title,artist,language_id,performer_type_id,version_label) values($1,'Shared Favorite','Shared Artist','mandarin','female','Acoustic') returning id",[family]))[0].id;
 await q("insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id) values($1,1,'secret shared lyric',true,'president')",[variant]);
 for(const room of ['papa',nativeRoom,'michelle','favorites-other','favorites-foreign'])for(const suffix of ['s1','s2','s3','hidden']){
  const id=room+'-'+suffix,data={songId:id,streamer_id:room,title:'Original '+suffix,artist:'Original Artist',cat:'Original Language',artistType:'Original Performer',tags:['Keep tag'],
   new:false,hidden:suffix==='hidden',murmur:'Public comment',creditCost:2,shortMode:'both',pairSongIds:[],lyrics:suffix==='s3'?'':'secret original lyric',
   key:'secret private key',privateNotes:'secret private notes',lyricHistory:['secret lyric history'],futurePrivate:{body:'secret future field'},_order:suffix==='s1'?0:1};
  await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,data]);
  if(suffix!=='s3')await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',
   [room,id,variant,suffix==='s2'?{...data,title:'Stale title'}:data]);
  if(suffix==='s1'){
   await q("insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body) values($1,$2,$3,'own','secret custom lyric')",[room,id,variant]);
   await q("insert into papa_catalog_private_notes(streamer_id,song_id,body) values($1,$2,'secret catalog private note')",[room,id]);
  }
 }
 const actor=(room='papa',space='space-001',subject=player,id='P1')=>({role:'player',account_id:subject,player_id:id,space_id:space,streamer_id:room});
 const business=async()=>({snapshot:await rpc('papa_v2_snapshot'),accounts:await q('select id,created_at,disabled_at from papa_accounts order by id'),
  bindings:await q('select account_id,legacy_player_id,verified_at from papa_account_legacy_players order by account_id'),
  members:await q('select id,account_id,space_id,role,streamer_id,status,created_at from papa_space_memberships order by id'),
  profiles:await q('select space_id,player_id,account_id,membership_id,data,updated_at from papa_space_player_profiles order by space_id,player_id'),
  links:await q('select streamer_id,song_id,variant_id,source_hash,linked_at from papa_catalog_song_links order by streamer_id,song_id'),
  variants:await q('select id,family_id,title,artist,active,updated_at from papa_catalog_variants order by id'),
  lyrics:await q('select variant_id,revision,body,active,actor_id,created_at from papa_catalog_lyric_revisions order by variant_id,revision'),
  selections:await q('select streamer_id,song_id,variant_id,mode,body,updated_at from papa_catalog_lyric_selections order by streamer_id,song_id'),
  notes:await q('select streamer_id,song_id,body,updated_at from papa_catalog_private_notes order by streamer_id,song_id'),
  notices:await q('select id,streamer_id,recipient,type,body,created_at from papa_notifications order by id'),
  push:await q('select to_jsonb(job) row from papa_push_jobs job order by id')});
 const favorites=()=>q('select account_id,space_id,player_id,streamer_id,song_id,is_favorite,created_at,updated_at from papa_song_favorites order by account_id,space_id,player_id,streamer_id,song_id');
 const events=()=>q("select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,actor_account_id,actor_display_name_snapshot,target_player_id,target_player_name_snapshot,space_id,before_data,after_data from papa_events where entity_kind='song_favorites' order by id");
 const before=await business();await db.exec(migration(favoriteMigration));assert.deepEqual(await business(),before,'migration neither infers identity nor rewrites business/shared/private rows');
 const set=(song,favorite=true,context=actor())=>rpc('papa_song_favorite_set',[context.space_id,context.streamer_id,context,song,favorite]);
 const page=(context=actor(),limit=20,offset=0)=>rpc('papa_song_favorites_page',[context.space_id,context.streamer_id,context,limit,offset]);
 const flags=(ids,context=actor())=>rpc('papa_song_favorite_flags',[context.space_id,context.streamer_id,context,ids]);
 return {db,q,rpc,actor,player,other,president,unbound,members,business,favorites,events,set,page,flags,variant};
}

for(const [space,room,name] of [['space-001','papa','Legacy Player'],[nativeSpace,nativeRoom,'Native Player']])test(room+' favorites can precede listening, remain idempotent and page safe live catalog metadata',async t=>{
 const {q,rpc,actor,other,business,favorites,events,set,page,flags,variant}=await fixture(t),context=actor(room,space),before=await business();
 assert.equal(before.snapshot.rows.filter(row=>['queue','ledger'].includes(row.kind)).length,0);
 const song=room+'-s1';assert.deepEqual(await set(song,true,context),{songId:song,favorite:true,changed:true});
 const saved=await favorites(),audit=await events();assert.equal(saved.length,1);assert.equal(audit.length,1);
 const repeated=await Promise.all([set(song,true,context),set(song,true,context)]);assert.ok(repeated.every(result=>result.favorite===true&&result.changed===false));
 assert.deepEqual(await favorites(),saved);assert.deepEqual(await events(),audit,'idempotent retry produces no extra audit');
 const event=audit[0];assert.equal(event.actor_account_id,context.account_id);assert.equal(event.actor_role,'player');assert.equal(event.actor_player_id,'P1');
 assert.equal(event.actor_display_name_snapshot,name);assert.equal(event.target_player_name_snapshot,name);assert.equal(event.space_id,space);assert.equal(event.streamer_id,room);
 assert.equal(event.after_data.title,'Shared Favorite');assert.equal(event.after_data.artist,'Shared Artist');assert.deepEqual(event.after_data.songSnapshot,{title:'Shared Favorite',artist:'Shared Artist'});assert.equal(event.after_data.favorite,true);assert.equal(event.before_data.favorite,false);
 for(const suffix of ['s2','s3'])await set(room+'-'+suffix,true,context);
 const ordered=(await q('select song_id from papa_song_favorites where account_id=$1 and space_id=$2 and streamer_id=$3 and is_favorite order by updated_at desc,song_id',[context.account_id,space,room])).map(row=>row.song_id);
 const pages=await Promise.all([page(context,1,0),page(context,1,1),page(context,1,2)]);assert.deepEqual(pages.map(result=>result.rows[0].songId),ordered);
 for(const [index,result] of pages.entries()){assert.equal(result.total,3);assert.equal(result.pageLimit,1);assert.equal(result.pageOffset,index);assert.equal(result.hasMore,index<2);}
 assert.deepEqual((await page(context,1,3)).rows,[]);assert.equal((await page(context,1,3)).total,3);
 const list=await page(context);for(const row of list.rows){assert.ok(Object.keys(row).every(key=>songKeys.has(key)));assert.equal(row.favorite,true);assert.equal(typeof row.favoritedAt,'string');}
 assert.doesNotMatch(JSON.stringify(list),/secret|privateNotes|lyricHistory|futurePrivate|account_id|player_id|sourceHash|source_hash/);
 const linked=list.rows.find(row=>row.songId===song);assert.equal(linked.title,'Shared Favorite');assert.equal(linked.hasLyrics,true);assert.equal(linked.hasSharedLyrics,true);assert.equal(linked.hasCustomLyrics,true);assert.equal(linked.lyricsMode,'own');assert.deepEqual(linked.tags,['Keep tag']);
 assert.equal(list.rows.find(row=>row.songId.endsWith('-s2')).title,'Original s2','stale source links never overwrite displayed source metadata');
 assert.equal(list.rows.find(row=>row.songId.endsWith('-s3')).hasLyrics,false);
 assert.deepEqual(await flags([room+'-s3',song],context),{songIds:[room+'-s3',song]});assert.deepEqual(await flags([],context),{songIds:[]});
 assert.deepEqual(await flags([song],actor(room,space,other,'P2')),{songIds:[]},'another verified player never inherits the current player favorite');
 assert.deepEqual(await business(),before,'favorite clicks create no queue/ledger/quota/identity/notification/shared writes');
 await q("update papa_catalog_variants set title='Updated Shared Favorite' where id=$1",[variant]);
 assert.equal((await page(context)).rows.find(row=>row.songId===song).title,'Updated Shared Favorite');
 assert.equal((await q("select data->>'title' title from papa_v2_entities where kind='songs' and id=$1",[song]))[0].title,'Original s1');
 await q("update papa_catalog_variants set title='Shared Favorite' where id=$1",[variant]);
 assert.deepEqual(await set(song,false,context),{songId:song,favorite:false,changed:true});const removed=await favorites();assert.equal(removed.length,3);assert.equal(removed.find(row=>row.song_id===song).is_favorite,false);
 assert.equal((await page(context)).total,2);assert.deepEqual(await flags([song],context),{songIds:[]});
 const count=(await events()).length;assert.equal((await set(song,false,context)).changed,false);assert.equal((await events()).length,count);assert.deepEqual(await business(),before);
});

test('favorites preserve hidden/deleted rows and rollback the preference when its summary audit fails',async t=>{
 const {db,q,actor,set,page,flags,favorites,events}=await fixture(t),context=actor();
 await assert.rejects(set('papa-hidden'),/SONG_FAVORITES_SONG_INVALID/);assert.equal((await favorites()).length,0);
 await set('papa-s1');await set('papa-s2');
 const source=(await q("select data from papa_v2_entities where kind='songs' and id='papa-s1'"))[0].data;
 await q("update papa_v2_entities set data=data||'{\"hidden\":true}'::jsonb where kind='songs' and id='papa-s1'");
 await q("delete from papa_v2_entities where kind='songs' and id='papa-s2'");
 assert.equal((await favorites()).length,2);assert.equal((await favorites()).every(row=>row.is_favorite),true);assert.equal((await page()).total,0);
 await assert.rejects(set('papa-s1',true),/SONG_FAVORITES_SONG_INVALID/);await assert.rejects(flags(['papa-s1']),/SONG_FAVORITES_SONG_INVALID/);
 assert.equal((await set('papa-s2',false)).changed,true,'a preserved deleted favorite can be unset without restoring the song');
 assert.equal((await favorites()).length,2);assert.equal((await favorites()).find(row=>row.song_id==='papa-s2').is_favorite,false);
 await q("update papa_v2_entities set data=$1 where kind='songs' and id='papa-s1'",[source]);
 const before={favorites:await favorites(),events:await events()};
 await db.exec("create function reject_favorite_audit() returns trigger language plpgsql as $$begin if new.entity_kind='song_favorites' then raise exception 'FIXTURE_AUDIT_FAILED';end if;return new;end$$;create trigger fixture_favorite_audit before insert on papa_events for each row execute function reject_favorite_audit();");
 await assert.rejects(set('papa-s3',true),/FIXTURE_AUDIT_FAILED/);await assert.rejects(set('papa-s1',false),/FIXTURE_AUDIT_FAILED/);
 assert.deepEqual({favorites:await favorites(),events:await events()},before,'both add and remove rollback if audit insertion fails');
});

test('favorites reject unverified identities, wrong Space/room/song, inactive Accounts/Memberships and direct browser access',async t=>{
 const {db,q,rpc,actor,player,other,unbound,members,business,set,page,flags,favorites,events}=await fixture(t),before=await business();
 const legacy=actor(),native=actor(nativeRoom,nativeSpace);
 for(const context of [null,{}, {...legacy,role:'streamer_admin'},{...legacy,account_id:null},{...legacy,account_id:'malformed'},
  {...legacy,account_id:other},{...legacy,player_id:'P2'},{...legacy,account_id:unbound},{...native,account_id:unbound},{...native,player_id:'PF'},
  {...legacy,space_id:nativeSpace},{...native,streamer_id:'papa'}]){
  const chosenSpace=context?.space_id||'space-001',chosenRoom=context?.streamer_id||'papa';
  await assert.rejects(rpc('papa_song_favorite_set',[chosenSpace,chosenRoom,context,'papa-s1',true]),/SONG_FAVORITES_(ACTOR|SCOPE)_INVALID/);
 }
 for(const id of ['missing','michelle-s1',nativeRoom+'-s1','favorites-foreign-s1','papa-hidden'])await assert.rejects(set(id),/SONG_FAVORITES_SONG_INVALID/);
 for(const [id,value] of [[null,true],['',true],['x'.repeat(201),true],['papa-s1',null]])await assert.rejects(set(id,value),/SONG_FAVORITES_INPUT_INVALID/);
 for(const ids of [null,[null],[''],['papa-s1','papa-s1'],Array.from({length:51},(_,i)=>'papa-'+i)])await assert.rejects(flags(ids),/SONG_FAVORITES_INPUT_INVALID/);
 await assert.rejects(flags(['michelle-s1']),/SONG_FAVORITES_SONG_INVALID/);
 for(const [limit,offset] of [[0,0],[51,0],[null,0],[20,-1],[20,10000001],[20,null]])await assert.rejects(page(legacy,limit,offset),/SONG_FAVORITES_PAGE_INVALID/);
 assert.deepEqual((await page(legacy,50,10000000)).rows,[]);
 await q('update papa_accounts set disabled_at=now() where id=$1',[player]);await assert.rejects(set('papa-s1'),/SONG_FAVORITES_ACTOR_INVALID/);await assert.rejects(page(native),/SONG_FAVORITES_ACTOR_INVALID/);await q('update papa_accounts set disabled_at=null where id=$1',[player]);
 for(const [key,context,song] of [['legacy-P1',legacy,'papa-s1'],[nativeSpace+'-P1',native,nativeRoom+'-s1']]){
  await q("update papa_space_memberships set status='suspended' where id=$1",[members[key]]);await assert.rejects(set(song,true,context),/SONG_FAVORITES_ACTOR_INVALID/);
  await q("update papa_space_memberships set status='active',role='space_admin' where id=$1",[members[key]]);await assert.rejects(page(context),/SONG_FAVORITES_ACTOR_INVALID/);
  await q("update papa_space_memberships set role='player' where id=$1",[members[key]]);
 }
 await q("update papa_spaces set status='suspended' where id=$1",[nativeSpace]);await assert.rejects(page(native),/SONG_FAVORITES_SCOPE_INVALID/);
 await q("update papa_spaces set status='active' where id=$1",[nativeSpace]);
 assert.equal((await favorites()).length,0);assert.equal((await events()).length,0);assert.deepEqual(await business(),before);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(set('papa-s1'),/permission denied/);await assert.rejects(page(),/permission denied/);await assert.rejects(flags(['papa-s1']),/permission denied/);await assert.rejects(q('select song_id from papa_song_favorites'),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');assert.equal((await set('papa-s1')).favorite,true);
 await assert.rejects(rpc('papa_song_favorite_actor',['space-001','papa',legacy]),/permission denied/);await db.exec('reset role');
 assert.deepEqual(await business(),before);
});

test('full backup preserves normalized favorite identity, timestamps and inactive/deleted rows without exposing its private wrapper',async t=>{
 const {db,q,rpc,president,player,actor,set,favorites,business}=await fixture(t);
 await set('papa-s1');await set('papa-s1',false);await set(nativeRoom+'-s2',true,actor(nativeRoom,nativeSpace));
 await q("delete from papa_v2_entities where kind='songs' and id=$1",[nativeRoom+'-s2']);
 const before=await business(),stored=await favorites(),backup=await rpc('papa_president_full_backup',[president]);
 const recoveryRows=(await q('select to_jsonb(favorite) row from papa_song_favorites favorite order by account_id,space_id,player_id,streamer_id,song_id')).map(row=>row.row);
 assert.deepEqual(backup.architecture.tables.papa_song_favorites,recoveryRows);assert.equal(backup.architecture.counts.papa_song_favorites,2);
 assert.equal(backup.architecture.manifest.tableOrder.at(-1),'papa_song_favorites');assert.equal(backup.architecture.formatVersion,1);
 assert.equal(stored.some(row=>row.is_favorite===false),true);assert.equal(stored.some(row=>row.song_id===nativeRoom+'-s2'&&row.is_favorite),true);
 assert.deepEqual(backup.rows,before.snapshot.rows);assert.deepEqual(await business(),before);assert.deepEqual(await favorites(),stored);
 await assert.rejects(rpc('papa_president_full_backup',[player]),/BACKUP_ACTOR_INVALID/);
 await db.exec('set role service_role');assert.equal((await rpc('papa_president_full_backup',[president])).architecture.counts.papa_song_favorites,2);
 await assert.rejects(rpc('papa_full_backup_before_song_favorites',[president]),/permission denied/);await db.exec('reset role');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc('papa_president_full_backup',[president]),/permission denied/);await db.exec('reset role');}
});
