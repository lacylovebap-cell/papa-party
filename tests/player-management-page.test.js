import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const pageMigration='202610090007_player_management_page.sql',nativeSpace='space-player-list',nativeRoom='player-list-room';
const allowed=new Set(['playerId','name','ids','names','certification','test','storedCredits']);
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('create role anon;create role authenticated;create role service_role;');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)', ['meta','1',{
  schemaVersion:3,streamers:[{id:'papa',slug:'papa',active:true},{id:'michelle',slug:'michelle',active:true}],
  streamerSettings:{papa:{},michelle:{radio_enabled:true,current_space:'radio'}}}]);
 const legacy=[
  {playerId:'P1',name:'Alpha',ids:['needle-id'],names:['Former Alpha'],certification:'verified',test:false,password:'legacy-secret',note:'private-note',history:['private-history']},
  {playerId:'P2',name:'Beta',ids:['beta-id'],names:['needle-alias'],certification:'',test:true,password:'legacy-secret-two'},
  {playerId:'P3',name:'Needle Delta',ids:['delta-id'],names:[],note:'private-note-three'},
  {playerId:'P4',name:'Gamma',ids:['gamma-id'],names:[]},
  {playerId:'P5',name:'Omega',ids:['other-room-id'],names:[]},
  {playerId:'P6',name:'Alpha',ids:['literal_%'],names:[]}
 ];
 for(const profile of legacy)await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)', ['players',profile.playerId,profile]);
 await db.exec(migration('202610070001_space_foundation.sql'));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(migration('202610070013_space_player_profiles.sql'));
 await q("insert into papa_spaces(id,slug,display_name) values($1,'player-list','Player List'),('space-list-foreign','list-foreign','Foreign')",[nativeSpace]);
 for(const [id,space] of [[nativeRoom,nativeSpace],['player-list-other',nativeSpace],['player-list-foreign','space-list-foreign']])
  await q('insert into papa_space_streamers(streamer_id,space_id) values($1,$2)',[id,space]);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 for(const id of [nativeRoom,'player-list-other','player-list-foreign'])meta.streamers.push({id,slug:id,active:true});
 meta.streamerSettings[nativeRoom]={radio_enabled:true,current_space:'radio'};
 meta.streamerSettings['player-list-other']={radio_enabled:false,current_space:'radio'};
 meta.streamerSettings['player-list-foreign']={};
 await q("update papa_v2_entities set data=$1 where kind='meta' and id='1'",[meta]);
 const subjects={};
 for(const [id,name,extra,space] of [
  ['P1','Native Alpha',{ids:['needle-native'],names:['Native Alias'],certification:'native-verified',test:false,note:'native-private-note',privateHistory:['native-private-history']},nativeSpace],
  ['P2','Native Beta',{ids:['native-beta'],names:['needle-native-alias']},nativeSpace],
  ['P3','Disabled Account',{ids:[],names:[]},nativeSpace],
  ['P4','Suspended Member',{ids:[],names:[]},nativeSpace],
  ['P6','Native Negative',{ids:[],names:[]},nativeSpace],
  ['P7','Native Zero',{ids:[],names:[]},nativeSpace],
  ['P8','Native Third',{ids:[],names:[]},nativeSpace],
  ['PF','Foreign Native',{ids:['foreign-id'],names:[]},'space-list-foreign']
 ]){
  const account=(await q('insert into papa_accounts default values returning id'))[0].id;
  const member=(await q("insert into papa_space_memberships(account_id,space_id,role) values($1,$2,'player') returning id",[account,space]))[0].id;
  await q('insert into papa_space_player_profiles(space_id,player_id,account_id,membership_id,data) values($1,$2,$3,$4,$5)',[space,id,account,member,{playerId:id,name,...extra}]);
  subjects[id]={account,member};
 }
 await q('update papa_accounts set disabled_at=now() where id=$1',[subjects.P3.account]);
 await q("update papa_space_memberships set status='suspended' where id=$1",[subjects.P4.member]);
 let ledgerId=0;
 const credit=async(room,playerId,amount,pool)=>{
  const id='credit-'+(++ledgerId),data={id,streamer_id:room,playerId,amount,note:'private-credit-note',privateHistory:['private-credit-history']};
  if(pool!==undefined)data.storage_pool=pool;
  await q("insert into papa_v2_entities(kind,id,data) values('ledger',$1,$2)",[id,data]);
 };
 for(const [id,amount,pool] of [['P1',10],['P1',0.5,null],['P1',-1,'shengma'],['P2',3,'shengma'],['P2',-3,'shengma'],['P3',-2,'shengma'],['P4',6,'radio'],['P6',2,'shengma']])await credit('papa',id,amount,pool);
 await credit('michelle','P5',20,'radio');await credit('michelle','P1',100,'shengma');
 for(const [id,amount,pool] of [['P1',2,'radio'],['P1',-0.5,'radio'],['P1',30,'shengma'],['P2',20],['P3',10,'radio'],['P4',10,'radio'],['P6',-1,'radio'],['P7',3,'radio'],['P7',-3,'radio'],['P8',3,'radio'],['PF',25,'radio']])await credit(nativeRoom,id,amount,pool);
 await credit('player-list-other','P2',40,'radio');await credit('player-list-foreign','PF',50,'radio');
 await q("insert into papa_v2_entities(kind,id,data) values('queue','reservation',$1)",[{id:'reservation',streamer_id:'papa',playerId:'P6',kind:'saved',status:'waiting',creditCost:20,consumed_storage_pool:'shengma'}]);
 const stable=async()=>({entities:await q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),
  accounts:await q('select id,created_at,disabled_at from papa_accounts order by id'),
  memberships:await q('select id,account_id,space_id,role,streamer_id,status,created_at from papa_space_memberships order by id'),
  profiles:await q('select space_id,player_id,account_id,membership_id,data,updated_at from papa_space_player_profiles order by space_id,player_id'),
  revision:await q('select id,revision from papa_v2_revision')});
 const before=await stable();await db.exec(migration(pageMigration));assert.deepEqual(await stable(),before,'additive migration rewrites no existing row');
 const page=async(space='space-001',room='papa',mode='stored',query='',limit=20,offset=0)=>(await q('select papa_player_management_page($1,$2,$3,$4,$5,$6) result',[space,room,mode,query,limit,offset]))[0].result;
 const settings=async(room,data)=>q("update papa_v2_entities set data=jsonb_set(data,array['streamerSettings',$1],$2::jsonb) where kind='meta' and id='1'",[room,data]);
 return {db,q,page,stable,settings,subjects};
}
function safeRows(result){
 assert.ok(Array.isArray(result.rows));
 for(const row of result.rows){assert.ok(Object.keys(row).every(key=>allowed.has(key)));assert.equal(typeof row.storedCredits,'number');}
 assert.doesNotMatch(JSON.stringify(result),/secret|private|account_id|membership_id|ledger|history|password|note/i);
}

test('legacy player management groups only the current room pool, paginates matching metadata and leaves data intact',async t=>{
 const {page,stable,settings}=await fixture(t),before=await stable();
 const stored=await page();safeRows(stored);
 assert.deepEqual(stored.rows.map(row=>[row.playerId,row.storedCredits]),[['P1',9.5],['P6',2]]);
 assert.equal(stored.total,2);assert.equal(stored.pageLimit,20);assert.equal(stored.pageOffset,0);
 assert.equal(stored.rows[0].certification,'verified');assert.equal(stored.rows[0].test,false);
 const all=await page('space-001','papa','all');safeRows(all);assert.equal(all.total,6);
 assert.equal(all.rows.find(row=>row.playerId==='P4').storedCredits,0,'radio credits do not count in legacy default shengma pool');
 assert.equal(all.rows.find(row=>row.playerId==='P5').storedCredits,0,'other room credits stay outside this grouped sum');
 assert.equal(all.rows.find(row=>row.playerId==='P3').storedCredits,-2,'negative balance remains visible only in all mode');
 const first=await page('space-001','papa','all','NEEDLE',1,0),second=await page('space-001','papa','all','needle',1,1),third=await page('space-001','papa','all','needle',1,2);
 assert.equal(first.total,3);assert.equal(second.total,3);assert.equal(third.total,3);
 assert.deepEqual([first.rows[0].playerId,second.rows[0].playerId,third.rows[0].playerId],['P1','P2','P3'],'name, ID and old names search before counting and pagination');
 assert.deepEqual((await page('space-001','papa','all','needle',1,3)).rows,[]);
 const literal=await page('space-001','papa','all','_%');assert.equal(literal.total,1);assert.equal(literal.rows[0].playerId,'P6','search characters are literal, not SQL wildcards');
 assert.deepEqual(await stable(),before,'list reads and defaults write no data or identity rows');
 await settings('papa',{radio_enabled:true,current_space:'radio'});
 const radio=await page();assert.deepEqual(radio.rows.map(row=>[row.playerId,row.storedCredits]),[['P4',6]],'radio mode counts only radio, even when shengma fallback credits are sufficient');
 await settings('papa',{radio_enabled:false,current_space:'radio'});
 assert.deepEqual((await page()).rows.map(row=>row.playerId),['P1','P6'],'disabled radio uses shengma without a settings backfill');
 await settings('papa',{});assert.deepEqual(await stable(),before);
});

test('native player management uses exact Space profiles and only active account-bound player memberships',async t=>{
 const {page,stable,q,subjects}=await fixture(t),before=await stable();
 const stored=await page(nativeSpace,nativeRoom);safeRows(stored);
 assert.deepEqual(stored.rows.map(row=>[row.playerId,row.storedCredits]),[['P1',1.5],['P8',3]]);assert.equal(stored.total,2);
 assert.equal(stored.rows[0].name,'Native Alpha');assert.equal(stored.rows[0].certification,'native-verified');
 const all=await page(nativeSpace,nativeRoom,'all');safeRows(all);assert.equal(all.total,5);
 assert.deepEqual(all.rows.map(row=>row.playerId),['P1','P2','P6','P8','P7']);
 assert.equal(all.rows.find(row=>row.playerId==='P2').storedCredits,0,'shengma fallback credits never enter a radio list balance');
 assert.equal(all.rows.find(row=>row.playerId==='P6').storedCredits,-1);assert.equal(all.rows.find(row=>row.playerId==='P7').storedCredits,0);
 const searched=await page(nativeSpace,nativeRoom,'all','needle',1,1);assert.equal(searched.total,2);assert.equal(searched.rows[0].playerId,'P2');
 assert.equal((await page(nativeSpace,nativeRoom,'all','legacy')).total,0,'matching legacy IDs or names do not infer a native identity');
 assert.equal((await page(nativeSpace,nativeRoom,'all','foreign')).total,0);
 assert.deepEqual(await stable(),before,'native list reads create or change no entities, accounts or memberships');
 await q("update papa_space_memberships set status='active',role='space_admin' where id=$1",[subjects.P4.member]);
 assert.equal((await page(nativeSpace,nativeRoom,'all')).rows.some(row=>row.playerId==='P4'),false,'a non-player membership cannot authorize a profile row');
 await q("update papa_space_memberships set status='suspended',role='player' where id=$1",[subjects.P4.member]);
 assert.deepEqual(await stable(),before);
});

test('player management rejects invalid bounds, modes, Space mapping and pool metadata without changing data',async t=>{
 const {page,stable,settings,q}=await fixture(t),before=await stable();
 for(const args of [
  ['space-001','papa','invalid'],['space-001','papa',null],['space-001','papa','all',null],['space-001','papa','all','x'.repeat(101)],
  ['space-001','papa','all','',0],['space-001','papa','all','',51],['space-001','papa','all','',null],
  ['space-001','papa','all','',20,-1],['space-001','papa','all','',20,10000001],['space-001','papa','all','',20,null]
 ])await assert.rejects(page(...args),/PLAYER_MANAGEMENT_PAGE_INVALID/);
 for(const args of [[nativeSpace,'papa'],['space-001',nativeRoom],[null,'papa'],['space-001',null],['missing','papa'],['space-001','unknown']])await assert.rejects(page(...args),/PLAYER_MANAGEMENT_SCOPE_INVALID/);
 await q("update papa_spaces set status='suspended' where id=$1",[nativeSpace]);
 await assert.rejects(page(nativeSpace,nativeRoom),/PLAYER_MANAGEMENT_SCOPE_INVALID/);
 await q("update papa_spaces set status='active' where id=$1",[nativeSpace]);
 assert.equal((await page('space-001','papa','all','',50,10000000)).total,6);assert.deepEqual((await page('space-001','papa','all','',50,10000000)).rows,[]);
 for(const bad of [{current_space:'space-001'},{current_space:null},{current_space:7},{radio_enabled:'true'},{radio_enabled:null}]){
  await settings('papa',bad);await assert.rejects(page(),/PLAYER_MANAGEMENT_POOL_INVALID/);await settings('papa',{});
 }
 const ledger=(await q("select id,data from papa_v2_entities where kind='ledger' and data->>'streamer_id'='papa' order by id limit 1"))[0];
 await q("update papa_v2_entities set data=data||'{\"storage_pool\":\"wrong-pool\"}'::jsonb where kind='ledger' and id=$1",[ledger.id]);
 await assert.rejects(page(),/PLAYER_MANAGEMENT_POOL_INVALID/);
 await q("update papa_v2_entities set data=$1 where kind='ledger' and id=$2",[ledger.data,ledger.id]);
 assert.deepEqual(await stable(),before,'all rejected reads preserve existing rows');
});

test('player management page is executable only through the service role and has no whole-snapshot or write path',async t=>{
 const {db,page,stable}=await fixture(t),before=await stable();
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(page(),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');assert.equal((await page()).total,2);await db.exec('reset role');
 assert.deepEqual(await stable(),before);
 const sql=migration(pageMigration);
 assert.doesNotMatch(sql,/\bselect\s+\*/i);
 assert.doesNotMatch(sql,/papa_(?:v2_\w*snapshot\w*|space_player_rows)\s*\(/i);
 assert.doesNotMatch(sql,/\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from)\b/i);
});
