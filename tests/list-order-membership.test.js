import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const stamp=n=>'2024-01-'+String(n).padStart(2,'0')+'T00:00:00.000Z';

async function fixture(t){
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text not null,id text not null,data jsonb not null,primary key(kind,id));
 create table papa_v2_sessions(token_hash text primary key,player_id text not null,login_id text,role text,streamer_id text,expires_at timestamptz not null);
 create table papa_v2_revision(id int primary key,revision bigint not null);insert into papa_v2_revision values(1,1);
 create table papa_streamer_accounts(streamer_id text primary key,password_hash text,enabled boolean);
 create table papa_president_accounts(account_key text primary key,password_hash text);
 create table papa_notice_config(id text primary key,value jsonb);
 create table papa_release_backups(release text primary key,snapshot jsonb);
 create function papa_v2_snapshot() returns jsonb language sql as $$select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(e)) from papa_v2_entities e))$$;
 create table papa_notifications(id uuid primary key default gen_random_uuid(),streamer_id text not null,streamer_name text,recipient text not null,type text,level smallint,body text,entity_id text,read_at timestamptz,created_at timestamptz not null default now());
 create table papa_push_subscriptions(id uuid primary key default gen_random_uuid(),streamer_id text,recipient text,endpoint text,subscription jsonb,session_hash text);
 create table papa_events(id bigint generated always as identity primary key,streamer_id text not null,entity_kind text not null,entity_id text not null,action text not null,actor_role text,actor_player_id text,created_at timestamptz not null default now(),effective_at text,before_data jsonb,after_data jsonb);
 create function papa_audit_redact(value jsonb) returns jsonb language sql immutable as $$select value$$;`);
 await q("insert into papa_v2_entities values('meta','1',$1)",[{streamers:[
  {id:'papa',slug:'papa',display_name:'Papa',active:true},{id:'michelle',slug:'michelle',display_name:'Michelle',active:true}],streamerSettings:{papa:{},michelle:{}}}]);
 const files=['202609250002_private_chat.sql','202609260001_board.sql','202609260002_board_integrity.sql',
  ...fs.readdirSync('supabase/migrations').filter(f=>/^202610(?:0100\d\d|05000[123]|0700\d\d|0800\d\d)_/.test(f))].sort();
 for(const file of files)await db.exec(migration(file));
 for(const file of ['202610090007_player_management_page.sql','202610090011_song_visibility_search.sql','202610090012_player_archive.sql'])await db.exec(migration(file));
 await q("insert into papa_spaces(id,slug,display_name) values('space-native','native','Native'),('space-foreign','foreign','Foreign')");
 await q("insert into papa_space_streamers(streamer_id,space_id) values('native-room','space-native'),('foreign-room','space-foreign')");
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 meta.streamers.push(...['native-room','foreign-room'].map(id=>({id,slug:id,display_name:id,active:true})));
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const family=async(n,title,created)=>{await q('insert into papa_catalog_families(id,title,created_at) values($1,$2,$3)',[uuid(n),title,created]);return uuid(n);};
 const families=[await family(1,'Alpha','2024-01-01T00:00:00Z'),await family(2,'Beta','2025-01-01T00:00:00Z'),
  await family(3,'Old Family','2023-01-01T00:00:00Z'),await family(4,'Needle Family','2022-01-01T00:00:00Z')];
 const variant=async(n,family,title,artist,kind,label,date)=>{
  await q('insert into papa_catalog_variants(id,family_id,title,artist,version_kind,version_label,language_text,performer_type_text,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [uuid(n),family,title,artist,kind,label,'英語','團體',date]);return uuid(n);
 };
 const originalA=await variant(101,families[0],'Same Title','Artist A','original','原版',stamp(1)),
  originalB=await variant(102,families[0],'Same Title','Artist B','original','原版',stamp(2)),
  dj=await variant(103,families[0],'Same Title','DJ Artist','remix','DJ版',stamp(3)),
  cover=await variant(201,families[1],'Newest Title','Artist C','cover','現場版','2025-01-01T00:00:00Z'),
  hidden=await variant(301,families[2],'Hidden Title','Artist D','original','原唱','2023-01-01T00:00:00Z');
 const song=async(id,room,variant,{stale=false,...extra}={})=>{
  const data={songId:id,streamer_id:room,title:'Local '+id,artist:'Local Artist',cat:'英語',_order:0,lyrics:'private lyric body',privateNotes:'secret private notes',...extra};
  await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,data]);
  if(variant)await q('insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash) values($1,$2,$3,papa_catalog_source_hash($4))',
   [room,id,variant,stale?{...data,title:'Stale title'}:data]);
  return data;
 };
 await song('own-original','papa',originalA);await song('peer-original','michelle',originalB);
 await song('stale-dj','papa',dj,{stale:true});await song('foreign-cover','foreign-room',cover);
 await song('native-cover','native-room',cover);await song('own-hidden','papa',hidden,{hidden:true});
 const needle=[];
 for(let i=0;i<25;i++){
  const id=await variant(1000+i,families[3],'Needle '+String(i).padStart(2,'0'),'Needle Artist','remix','DJ版',stamp(i+1));needle.push(id);
  await song('needle-'+i,i%2?'michelle':'papa',id);
 }
 for(const [id,extra] of [['dated-old',{created_at:stamp(1),tags:['情歌','慢歌'],new:true,_order:4}],
  ['dated-new',{createdAt:stamp(3),tags:['情歌'],_order:3}],['dated-tie',{created_at:stamp(3),tags:['慢歌','新練'],_order:2}],
  ['undated-a',{tags:['情歌'],new:'true',_order:0}],['undated-b',{created_at:'2024-99-99T00:00:00Z',tags:'broken',_order:1}]])
  await song(id,'native-room',null,extra);
 for(const [id,name,date,extra] of [['P1','Zebra',stamp(1),{}],['P2','Alpha',stamp(3),{}],['P3','Beta',stamp(3),{}],
  ['P4','Missing',null,{}],['P5','Archived',stamp(4),{archived:true}],['P6','Invalid','2024-99-99T00:00:00Z',{}]]){
  const data={playerId:id,name,ids:['filter-id'],names:[],password:'secret password',note:'private player note',...(date?{created_at:date}:{}),...extra};
  await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,data]);
  const account=(await q('insert into papa_accounts default values returning id'))[0].id;
  const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-native','player') returning id",[account]))[0].id;
  const {password,...native}=data;
  await q("insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values('space-native',$1,$2,$3,$4)",[id,account,member,native]);
 }
 await q("insert into papa_v2_entities(kind,id,data) values('ledger','credit',$1)",[{id:'credit',streamer_id:'native-room',playerId:'P1',amount:2,storage_pool:'shengma',note:'private ledger note'}]);
 const stable=async()=>{
  const result={};for(const [table,order] of [['papa_v2_entities','kind,id'],['papa_catalog_song_links','streamer_id,song_id'],
   ['papa_catalog_families','id'],['papa_catalog_variants','id'],['papa_space_player_profiles','space_id,player_id'],['papa_v2_revision','id']])
   result[table]=await q('select to_jsonb(source) row from '+table+' source order by '+order);return result;
 };
 const before=await stable();await db.exec(migration('202610100018_list_order_and_membership.sql'));assert.deepEqual(await stable(),before);
 await db.exec(migration('202610120004_catalog_visible_metadata_search.sql'));assert.deepEqual(await stable(),before);
 const search=({query='',room='papa',space='space-001',membership='all',sort='default',limit=10,offset=0,kind='',label='',mode='metadata'}={})=>
  rpc('papa_catalog_search_filtered_v2',[query,limit,offset,room,null,null,mode,space,membership,sort,kind,label]);
 const familyPage=({query='',room='papa',space='space-001',membership='all',sort='default',limit=20,offset=0,kind='',label=''}={})=>
  rpc('papa_catalog_families_page_v4_in_space',[query,'all',limit,offset,'',kind,room,space,membership,sort,label]);
 const publicPage=({query='',space='space-001',sort='default',limit=12,offset=0,kind='',label=''}={})=>
  rpc('papa_catalog_public_page_filtered_v2_in_space',[query,'','',kind,limit,offset,space,sort,label]);
 const songs=({query='',tags=[],match='any',sort='default',limit=50,offset=0,room='native-room',space='space-native'}={})=>
  rpc('papa_song_search_room_v4',[room,query,tags,limit,offset,null,'visible','all',space,sort,match]);
 const players=({space='space-native',room='native-room',sort='default',mode='all',archived=false,query='',limit=20,offset=0}={})=>
  rpc('papa_player_management_page_v3',[space,room,mode,query,limit,offset,archived,sort]);
 return {db,q,rpc,search,familyPage,publicPage,songs,players,stable,families,needle,originalA,originalB,dj,cover,hidden};
}
const safe=result=>assert.doesNotMatch(JSON.stringify(result),/private lyric|secret|privateNotes|password|lyricHistory|source_hash|account_id|membership_id/);

test('approved family search matches visible classification and approved lyrics without exposing lyric text or private room song content',async t=>{
 const f=await fixture(t);
 await f.q("update papa_catalog_variants set performer_detail='男歌手',version_note='慢板改編' where id=$1",[f.originalA]);
 await f.q("insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id) values($1,1,'approved secret melodicneedle',true,'president')",[f.originalA]);
 for(const query of ['英語 團體 男歌手','慢板改編','melodicneedle']){const result=await f.familyPage({query});assert.equal(result.total,1);assert.equal(result.rows[0].id,f.families[0]);safe(result);assert.doesNotMatch(JSON.stringify(result),/melodicneedle|lyricMatch|snippet|matchedLyrics/);}
 assert.equal((await f.familyPage({query:'private lyric body'})).total,0);
 await f.q('update papa_catalog_lyric_revisions set active=false where variant_id=$1',[f.originalA]);assert.equal((await f.familyPage({query:'melodicneedle'})).total,0);
});
const stripDates=value=>JSON.parse(JSON.stringify(value),(key,value)=>key==='createdAt'?undefined:value);

test('018 additive sort and catalog membership pages preserve projections, counts, privacy and scoped authority',async t=>{
 const f=await fixture(t),before=await f.stable();
 await t.test('room song ordering uses actual dates, stable ties and undated IDs; default preserves old order',async()=>{
  const query='Local dated';
  assert.deepEqual((await f.songs({query,sort:'newest'})).songIds,['dated-new','dated-tie','dated-old','undated-a','undated-b']);
  assert.deepEqual((await f.songs({query,sort:'oldest'})).songIds,['dated-old','dated-new','dated-tie','undated-a','undated-b']);
  assert.deepEqual((await f.songs({query})).songIds,['undated-a','undated-b','dated-tie','dated-new','dated-old']);
  const undated=await f.songs({query:'Local undated',sort:'newest'});assert.deepEqual(undated.songIds,['undated-a','undated-b']);safe(undated);
  const first=await f.songs({query,sort:'newest',limit:1}),second=await f.songs({query,sort:'newest',limit:1,offset:1});
  assert.equal(first.total,5);assert.equal(second.total,5);assert.equal(first.hasMore,true);assert.deepEqual(second.songIds,['dated-tie']);
  assert.deepEqual(Object.keys(first).sort(),['hasMore','songIds','total']);
  const old=await f.rpc('papa_song_search_room_v3',['native-room',query,[],50,0,null,'visible','all','space-native']);assert.deepEqual(await f.songs({query}),old);
 });
 await t.test('reserved new practice query and tag work without backfill; ordinary tag OR and explicit proxy AND are distinct',async()=>{
  assert.deepEqual((await f.songs({tags:['新練']})).songIds,['dated-tie','dated-old']);
  assert.deepEqual((await f.songs({query:'新練'})).songIds,['dated-tie','dated-old']);
  assert.deepEqual((await f.songs({query:'新練 Local dated-old'})).songIds,['dated-old']);
  assert.deepEqual((await f.songs({tags:['新練','情歌'],match:'all'})).songIds,['dated-old']);
  assert.deepEqual((await f.songs({tags:['情歌','慢歌'],match:'all'})).songIds,['dated-old']);
  assert.deepEqual((await f.songs({tags:['情歌','慢歌']})).songIds,['undated-a','dated-tie','dated-new','dated-old']);
  assert.deepEqual((await f.songs({tags:['新練','不存在'],match:'all'})).songIds,[]);
 });
 await t.test('legacy and native player sort before count/page without leaking credentials or changing credit grouping',async()=>{
  for(const [space,room] of [['space-001','papa'],['space-native','native-room']]){
   const newest=await f.players({space,room,sort:'newest'}),oldest=await f.players({space,room,sort:'oldest'}),normal=await f.players({space,room});
   assert.deepEqual(newest.rows.map(r=>r.playerId),['P2','P3','P1','P4','P6']);assert.deepEqual(oldest.rows.map(r=>r.playerId),['P1','P2','P3','P4','P6']);
   const old=await f.rpc('papa_player_management_page_v2',[space,room,'all','',20,0,false]);assert.deepEqual(normal,old);safe(newest);
   assert.equal((await f.players({space,room,archived:true,sort:'newest'})).rows[0].playerId,'P5');
   const page=await f.players({space,room,query:'filter-id',sort:'newest',limit:1,offset:2});assert.equal(page.total,5);assert.equal(page.rows[0].playerId,'P1');
  }
  const stored=await f.players({mode:'stored',sort:'newest'});assert.equal(stored.total,1);assert.equal(stored.rows[0].storedCredits,2);safe(stored);
 });
 await t.test('Added and Missing variant tabs filter the entire matching set before their independent count and page',async()=>{
  const added=await f.search({query:'Needle',membership:'added',limit:10}),addedNext=await f.search({query:'Needle',membership:'added',limit:10,offset:10}),
   missing=await f.search({query:'Needle',membership:'missing',limit:10}),missingNext=await f.search({query:'Needle',membership:'missing',limit:10,offset:10});
  assert.equal(added.total,13);assert.equal(added.rows.length,10);assert.equal(addedNext.rows.length,3);assert.equal(added.hasMore,true);assert.equal(addedNext.hasMore,false);
  assert.equal(missing.total,12);assert.equal(missing.rows.length,10);assert.equal(missingNext.rows.length,2);
  assert.deepEqual([...added.rows,...addedNext.rows].map(r=>r.id),f.needle.filter((_,i)=>i%2===0));
  assert.deepEqual([...missing.rows,...missingNext.rows].map(r=>r.id),f.needle.filter((_,i)=>i%2===1));
  assert.equal(added.rows.every(r=>r.alreadyAdded),true);assert.equal(missing.rows.every(r=>!r.alreadyAdded),true);safe(added);safe(missing);
  assert.equal((await f.search({query:'Needle',membership:'added',limit:10,offset:10000})).rows.length,0);
 });
 await t.test('relationship membership belongs to the verified room and Space; stale links never grant Added',async()=>{
  const own=await f.search({membership:'added',limit:50});assert.equal(own.rows.some(r=>r.id===f.originalA),true);assert.equal(own.rows.some(r=>r.id===f.originalB),false);
  assert.equal(own.rows.some(r=>r.id===f.hidden),true,'a hidden song still belongs to the owner songbook');assert.equal(own.rows.some(r=>r.id===f.dj),false);
  assert.equal(own.rows.some(r=>r.id===f.cover),false,'a different Space cannot grant room membership');
  const native=await f.search({room:'native-room',space:'space-native',membership:'added'});assert.deepEqual(native.rows.map(r=>r.id),[f.cover]);
  await assert.rejects(f.search({room:'native-room',space:'space-001',membership:'added'}),/SCOPE_INVALID/);
  await assert.rejects(f.familyPage({room:'foreign-room',space:'space-native',membership:'added'}),/SCOPE_INVALID/);
  await assert.rejects(f.search({room:null,membership:'missing'}),/ROOM_REQUIRED/);
 });
 await t.test('family pagination keeps all eligible versions together and preserves different artists with the same original label',async()=>{
  const first=await f.familyPage({limit:1}),second=await f.familyPage({limit:1,offset:1});assert.equal(first.total,4);assert.equal(second.total,4);
  assert.equal(first.rows[0].id,f.families[0]);assert.equal(first.rows[0].variants.length,3);
  assert.deepEqual(first.rows[0].variants.filter(v=>v.versionLabel==='原版').map(v=>v.artist).sort(),['Artist A','Artist B']);
  const all=await f.familyPage({query:'Needle',limit:1});assert.equal(all.total,1);assert.equal(all.rows[0].variants.length,25);assert.equal(all.hasMore,false);
  const added=await f.familyPage({membership:'added',limit:1}),missing=await f.familyPage({membership:'missing',limit:1});
  assert.equal(added.total,3);assert.equal(missing.total,3);assert.equal(added.rows[0].variants.every(v=>v.alreadyAdded),true);assert.equal(missing.rows[0].variants.every(v=>!v.alreadyAdded),true);
  assert.deepEqual((await f.familyPage({sort:'newest'})).rows.map(r=>r.id),[f.families[1],f.families[0],f.families[2],f.families[3]]);
  assert.deepEqual((await f.familyPage({sort:'oldest'})).rows.map(r=>r.id),[f.families[3],f.families[2],f.families[0],f.families[1]]);safe(first);
 });
 await t.test('public common songbook sorts families and scopes visibility/room relationships before every page',async()=>{
  const normal=await f.publicPage(),newest=await f.publicPage({sort:'newest',limit:1}),oldest=await f.publicPage({sort:'oldest',limit:1});
  assert.equal(normal.total,2);assert.equal(newest.total,2);assert.equal(newest.rows[0].familyId,f.families[0]);assert.equal(oldest.rows[0].familyId,f.families[3]);
  assert.equal(normal.rows.flatMap(r=>r.variants).some(v=>v.variantId===f.hidden||v.variantId===f.cover||v.variantId===f.dj),false);
  const old=await f.rpc('papa_catalog_public_page_filtered_in_space',['','','','',12,0,'space-001']);
  const {filters,...newView}=stripDates(normal),{filters:oldFilters,...oldView}=old;assert.deepEqual(newView,oldView);
  assert.deepEqual(filters.versionKinds,oldFilters.versionKinds);assert.deepEqual(filters.languages,oldFilters.languages);
  const native=await f.publicPage({space:'space-native'});assert.equal(native.total,1);assert.equal(native.rows[0].familyId,f.families[1]);safe(normal);safe(native);
 });
 await t.test('lightweight version kind/label facets include actual DJ/custom labels independently of text, membership and pagination',async()=>{
  const full=await f.search({limit:1}),empty=await f.search({query:'no-match',membership:'missing',offset:30});
  assert.deepEqual(empty.filters,full.filters);assert.deepEqual(full.filters.versionKinds,['cover','original','remix']);
  assert.deepEqual(full.filters.versionLabels,['DJ版','原唱','原版','現場版']);
  const family=await f.familyPage({query:'no-match'});assert.deepEqual(family.filters.versionLabels,full.filters.versionLabels);
  const exact=await f.search({label:'DJ版',membership:'missing',limit:50});assert.equal(exact.total,13);assert.equal(exact.rows.every(r=>r.versionLabel==='DJ版'),true);
  assert.equal((await f.search({kind:'original',label:'DJ版'})).total,0);
  const publicPage=await f.publicPage({query:'no-match'});assert.deepEqual(publicPage.filters.versionLabels,['DJ版','原版']);
 });
 await t.test('bounded selectors reject invalid sort, membership, scope and pages; all new functions remain service-only',async()=>{
  for(const sort of ['title','NEWEST',null])for(const call of [f.search,f.familyPage,f.publicPage,f.songs,f.players])await assert.rejects(call({sort}));
  for(const membership of ['mine','',null])for(const call of [f.search,f.familyPage])await assert.rejects(call({membership}));
  for(const call of [f.search,f.familyPage,f.songs])await assert.rejects(call({limit:51}));
  await assert.rejects(f.publicPage({limit:21}));await assert.rejects(f.players({limit:51}));
  await assert.rejects(f.songs({room:'native-room',space:'space-001'}),/SCOPE_INVALID/);
  await assert.rejects(f.players({room:'native-room',space:'space-001'}),/SCOPE_INVALID/);
  await assert.rejects(f.songs({match:'some'}),/FILTER_INVALID/);
  const funcs=await f.q("select p.oid::regprocedure::text signature,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('papa_list_record_created','papa_list_song_new','papa_list_catalog_scope','papa_list_catalog_members','papa_player_management_page_v3','papa_song_search_room_v4','papa_catalog_search_filtered_v2','papa_catalog_families_page_v4_in_space','papa_catalog_public_page_filtered_v2_in_space')");
  assert.equal(funcs.length,9);assert.equal(funcs.every(f=>!f.anon&&!f.authenticated&&f.service),true);
 });
 assert.deepEqual(await f.stable(),before,'all new list/sort/tab operations are read-only');
});

test('018 retains the selective lyric/source GIN search and evaluates grouped relationships once per page',async t=>{
 const f=await fixture(t);
 const definition=(await f.q("select pg_get_functiondef('papa_song_search_room_v4(text,text,text[],integer,integer,text,text,text,text,text,text)'::regprocedure) definition"))[0].definition;
 assert.equal((definition.match(/candidate_ids as materialized/g)||[]).length,1);
 assert.doesNotMatch(definition,/jsonb_agg\([^)]*data|papa_catalog_song_metadata|papa_v2_snapshot/i);
 await f.q("insert into papa_v2_entities(kind,id,data) select 'songs','index-fixture-'||i,jsonb_build_object('songId','index-fixture-'||i,'streamer_id','papa','title','Filler '||i,'lyrics',case when i=1234 then 'uniqueIndexNeedle' else repeat('ordinary filler lyric ',8)||i end) from generate_series(1,2000) i");
 await f.db.exec('vacuum analyze papa_v2_entities');
 const sourceSql=definition.slice(definition.indexOf('select e.id,e.space_id'),definition.indexOf('),candidate_ids as materialized'))
  .replace(/\banchor is not null/g,"papa_catalog_search_anchor('uniqueindexneedle') is not null")
  .replace(/\blike pattern/g,"like papa_catalog_search_pattern('uniqueindexneedle')");
 const plan=(await f.q('explain (analyze,buffers,format json) '+sourceSql))[0]['QUERY PLAN'];
 assert.match(JSON.stringify(plan),/papa_song_search_source_trgm/);assert.equal(plan[0].Plan['Actual Rows'],1);
 for(const signature of ['papa_catalog_search_filtered_v2(text,integer,integer,text,text,text,text,text,text,text,text,text)',
  'papa_catalog_families_page_v4_in_space(text,text,integer,integer,text,text,text,text,text,text,text)']){
  const body=(await f.q('select pg_get_functiondef($1::regprocedure) definition',[signature]))[0].definition;
  assert.equal((body.match(/papa_list_catalog_members\(/g)||[]).length,1,'one grouped relationship CTE per page');
  assert.doesNotMatch(body,/\bloop\b|papa_v2_snapshot|jsonb_agg\([^)]*data/i);
 }
 const membershipPlan=(await f.q("explain (analyze,format json) with members as materialized (select * from papa_list_catalog_members('papa','space-001')) select v.id,coalesce(m.already_added,false) from papa_catalog_variants v left join members m on m.variant_id=v.id order by v.title,v.id limit 10"))[0]['QUERY PLAN'];
 const walk=node=>[node,...(node.Plans||[]).flatMap(walk)];
 const members=walk(membershipPlan[0].Plan).filter(node=>node['Node Type']==='Function Scan'&&node['Function Name']==='papa_list_catalog_members');
 assert.equal(members.length,1);assert.equal(members[0]['Actual Loops'],1,'membership aggregation is not repeated for each displayed variant');
 const response=await f.songs({room:'papa',space:'space-001',query:'uniqueindexneedle',limit:10});
 assert.deepEqual(response.songIds,['index-fixture-1234']);safe(response);
});
