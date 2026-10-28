import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {empty,mutate,DEFAULTS} from '../src/core.js';
import {stateEntries} from '../src/state-patch.js';

const migration=name=>fs.readFileSync('supabase/migrations/'+name,'utf8');
const at='2026-10-28T01:00:00Z';
const PRESIDENT_PASSWORD='president-secret-2026';

async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;create extension if not exists pgcrypto;create table party_state(id int primary key,data jsonb);');
 await q('insert into party_state values(1,$1)',[{settings:{adminPassword:PRESIDENT_PASSWORD}}]);
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql','202609280001_manager_passwords.sql'])await db.exec(migration(name));
 const legacy=mutate(empty(),{type:'song',data:{title:'Papa song',artist:'Artist'}},{role:'admin'},at);
 legacy.players=[{playerId:'P1',name:'Shared Player',ids:[]}];
 for(const entry of stateEntries(legacy))await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[entry.kind,entry.id,entry.data]);
 for(const name of ['202610070001_space_foundation.sql','202610070002_device_sessions.sql','202610070003_verified_identity_binding.sql',
  '202610070004_audit_actor_snapshots.sql','202610070009_scoped_read_snapshot.sql'])await db.exec(migration(name));
 const directory=migration('202610070012_catalog_space_relations.sql');
 await db.exec(directory.slice(directory.indexOf('create or replace function public.papa_streamer_directory'),directory.indexOf('$$;')+3));
 await db.exec(migration('202610070013_space_player_profiles.sql'));
 const audit=migration('202610080012_communication_space.sql');
 for(const name of ['papa_communication_player_name','papa_native_meta_audit_projection','papa_event_actor_snapshot']){
  const start=audit.indexOf('function '+name+'('),statement=audit.lastIndexOf('create ',start);
  await db.exec(audit.slice(statement,audit.indexOf('$$;',start)+3));
 }
 for(const name of ['202610090003_streamer_registry.sql','202610190001_public_routes.sql'])await db.exec(migration(name));
 await db.exec(fs.readFileSync('ops/platform-management-approved-release.sql','utf8'));
 for(const name of ['20261024222350_platform_management_empty_halls_and_grouped_roles.sql','20261025213142_platform_space_center_directory.sql',
  '20261028041500_management_accounts_and_deletion.sql'])await db.exec(migration(name));
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const president=await account(),outsider=await account();
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('president',$1)",[president]);
 const meta=async()=>(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 const revision=async()=>Number((await q('select revision from papa_v2_revision where id=1'))[0].revision);
 const room=(name,slug)=>({id:randomUUID(),slug,display_name:name,home_title:name,subtitle:'',description:'',avatar_url:'',banner_url:'',active:true,created_at:at,updated_at:at});
 const settings=()=>({...structuredClone(DEFAULTS),tags:[]});
 const provision=(who,payload,password=null,op=randomUUID())=>rpc('papa_management_provision_streamer',[who,op,payload,password,null]);
 const login=(who,payload,password=null,op=randomUUID())=>rpc('papa_management_streamer_login',[who,op,payload,password,null]);
 const review=(who,space,streamer=null)=>rpc('papa_management_delete_review',[who,space,streamer]);
 const remove=(who,payload,op=randomUUID())=>rpc('papa_management_delete',[who,op,payload]);
 const streamerLogin=async(roomId,password)=>{
  const token='streamer:'+randomUUID();const hash=createHash('sha256').update(token).digest('hex');
  const ok=await rpc('papa_manager_login',['streamer',roomId,password,null,hash]);
  return ok?rpc('papa_bind_verified_legacy_session',[hash]):null;
 };
 const hallCreate=async name=>(await rpc('papa_manage_space',[president,randomUUID(),'create',{name,kind:'hall'}])).id;
 return {db,q,rpc,president,outsider,account,meta,revision,room,settings,provision,login,review,remove,streamerLogin,hallCreate};
}

test('independent streamer: one atomic provision creates Space, streamer, login, Account and membership that can really log in',async t=>{
 const f=await fixture(t);
 const descriptor=f.room('仙女','fairy'),op=randomUUID();
 const payload={mode:'independent',spaceName:'仙女',room:descriptor,settings:f.settings(),loginEnabled:true};
 const result=await f.provision(f.president,payload,'fairy-pass-1',op);
 assert.equal(result.streamerId,descriptor.id);assert.equal(result.spaceCreated,true);assert.equal(result.loginEnabled,true);assert.ok(result.accountId);
 const [space]=await f.q('select * from papa_spaces where id=$1',[result.spaceId]);
 assert.equal(space.tenant_kind,'independent');assert.equal(space.status,'suspended');assert.equal(space.display_name,'仙女');
 assert.equal((await f.q('select space_id from papa_space_streamers where streamer_id=$1',[descriptor.id]))[0].space_id,result.spaceId);
 assert.ok((await f.meta()).streamers.some(r=>r.id===descriptor.id&&r.slug==='fairy'));
 assert.deepEqual((await f.q("select role,status from papa_space_memberships where account_id=$1",[result.accountId])),[{role:'streamer_admin',status:'active'}]);
 const audits=await f.q('select action,request_data from papa_management_audit where space_id=$1 order by created_at',[result.spaceId]);
 assert.deepEqual(audits.map(a=>a.action).sort(),['create','provision_streamer']);
 assert.ok(!JSON.stringify(audits).includes('fairy-pass-1'),'password never reaches Audit');
 assert.deepEqual(await f.provision(f.president,payload,'fairy-pass-1',op),result,'replay returns the original result');
 await assert.rejects(f.provision(f.president,{...payload,spaceName:'Other'},'fairy-pass-1',op),/OPERATION_CONFLICT/);
 const identity=await f.streamerLogin(descriptor.id,'fairy-pass-1');
 assert.equal(identity.accountId,result.accountId);assert.equal(identity.role,'streamer_admin');assert.equal(identity.spaceId,result.spaceId);
 assert.equal(await f.streamerLogin(descriptor.id,'wrong-pass'),null);
 await assert.rejects(f.provision(f.president,{mode:'streamer',spaceId:result.spaceId,room:f.room('第二位','second'),settings:f.settings()}),/INDEPENDENT_SINGLE_STREAMER/);
 const readiness=await f.rpc('papa_management_space_readiness',[f.president,result.spaceId]);
 assert.deepEqual(readiness.items.map(i=>[i.code,i.done]),[['streamer',true],['login',true],['operations',false],['route',false]]);
});

test('hall and 聲瑪 streamers get logins at creation; an existing streamer without login can be backfilled later',async t=>{
 const f=await fixture(t);
 const hall=await f.hallCreate('測試廳');
 const inHall=await f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('廳內主播','hall-host'),settings:f.settings(),loginEnabled:true},'host-pass-1');
 assert.ok(await f.streamerLogin(inHall.streamerId,'host-pass-1'));
 const shengma=await f.provision(f.president,{mode:'streamer',spaceId:'space-001',room:f.room('聲瑪新主播','sm-new'),settings:f.settings(),loginEnabled:true},'sm-pass-1');
 assert.equal((await f.streamerLogin(shengma.streamerId,'sm-pass-1')).spaceId,'space-001');
 const bare=await f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('沒有帳號','no-login'),settings:f.settings()});
 assert.equal(bare.loginExists,false);assert.equal(bare.accountId,null);
 const before=await f.rpc('papa_management_streamer_login_status',[f.president,hall,bare.streamerId]);
 assert.equal(before.exists,false);assert.equal(before.slug,'no-login');assert.equal(before.operational,false);
 await assert.rejects(f.login(f.president,{spaceId:hall,streamerId:bare.streamerId,enabled:true}),/PASSWORD_REQUIRED/);
 const backfilled=await f.login(f.president,{spaceId:hall,streamerId:bare.streamerId,enabled:true},'later-pass-1');
 assert.ok(backfilled.accountId);
 assert.equal((await f.streamerLogin(bare.streamerId,'later-pass-1')).accountId,backfilled.accountId);
 const disabled=await f.login(f.president,{spaceId:hall,streamerId:bare.streamerId,enabled:false});
 assert.equal(disabled.loginEnabled,false);assert.equal(await f.streamerLogin(bare.streamerId,'later-pass-1'),null);
 const status=await f.rpc('papa_management_streamer_login_status',[f.president,hall,bare.streamerId]);
 assert.deepEqual([status.exists,status.enabled,status.accountId],[true,false,backfilled.accountId]);
});

test('provisioning is atomic and validated: duplicate code, weak or president password and non-president callers change nothing',async t=>{
 const f=await fixture(t);
 const hall=await f.hallCreate('驗證廳');
 const snapshot=async()=>JSON.stringify([await f.meta(),await f.q('select * from papa_space_streamers order by streamer_id'),
  await f.q('select streamer_id from papa_streamer_accounts order by 1'),await f.q('select id from papa_accounts order by id')]);
 const before=await snapshot();
 await assert.rejects(f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('撞名','papa'),settings:f.settings()}),/DUPLICATE/);
 await assert.rejects(f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('弱密碼','weak'),settings:f.settings(),loginEnabled:true},'abc'),/PAYLOAD_INVALID/);
 await assert.rejects(f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('同總裁','same'),settings:f.settings(),loginEnabled:true},PRESIDENT_PASSWORD),/SAME_AS_PRESIDENT/);
 await assert.rejects(f.provision(f.president,{mode:'independent',spaceName:'回滾',room:f.room('回滾','rollback'),settings:f.settings(),loginEnabled:true},PRESIDENT_PASSWORD),/SAME_AS_PRESIDENT/);
 await assert.rejects(f.provision(f.president,{mode:'streamer',spaceId:hall,room:{...f.room('壞代碼','x'),slug:'Bad Slug'},settings:f.settings()}),/DESCRIPTOR_INVALID/);
 await assert.rejects(f.provision(f.president,{mode:'streamer',spaceId:hall,room:{...f.room('私欄位','private'),secret:'x'},settings:f.settings()}),/DESCRIPTOR_INVALID/);
 assert.equal(await snapshot(),before,'failed provisioning leaves registry, mappings, credentials and Accounts unchanged');
 assert.equal((await f.q("select count(*)::int n from papa_spaces where display_name='回滾'"))[0].n,0);
 const streamer=await f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('主播帳號','host'),settings:f.settings(),loginEnabled:true},'host-pass-1');
 for(const who of [f.outsider,streamer.accountId,null]){
  await assert.rejects(f.provision(who,{mode:'streamer',spaceId:hall,room:f.room('越權','escalate'),settings:f.settings()}),/ACCESS_DENIED/);
  await assert.rejects(f.login(who,{spaceId:hall,streamerId:streamer.streamerId,enabled:true},'take-over-1'),/ACCESS_DENIED/);
  await assert.rejects(f.review(who,hall,streamer.streamerId),/ACCESS_DENIED/);
  await assert.rejects(f.rpc('papa_management_account_list',[who,'',1]),/ACCESS_DENIED/);
 }
 for(const role of ['anon','authenticated'])for(const fn of ['papa_management_provision_streamer(uuid,uuid,jsonb,text,text)','papa_management_delete(uuid,uuid,jsonb)','papa_management_account_list(uuid,text,integer)'])
  assert.equal((await f.q('select has_function_privilege($1,$2,\'execute\') ok',[role,fn]))[0].ok,false);
 assert.equal((await f.q("select has_function_privilege('service_role','papa_management_registry_write(uuid,text,jsonb,jsonb,bigint)','execute') ok"))[0].ok,false);
});

test('account list shows every management Account across all Spaces with login codes and searchable roles',async t=>{
 const f=await fixture(t);
 const hall=await f.hallCreate('星光廳');
 await f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('星星','star'),settings:f.settings(),loginEnabled:true},'star-pass-1');
 await f.provision(f.president,{mode:'independent',spaceName:'仙女',room:f.room('仙女','fairy'),settings:f.settings(),loginEnabled:true},'fairy-pass-1');
 await f.provision(f.president,{mode:'streamer',spaceId:'space-001',room:f.room('咪醬','mi'),settings:f.settings(),loginEnabled:true},'mi-pass-1');
 const all=await f.rpc('papa_management_account_list',[f.president,'',1]);
 assert.equal(all.total,4);assert.equal(all.rows[0].kind,'president');
 const byCode=Object.fromEntries(all.rows.filter(r=>r.loginCode).map(r=>[r.loginCode,r]));
 assert.deepEqual(Object.keys(byCode).sort(),['fairy','mi','star']);
 assert.equal(byCode.fairy.roles[0].spaceKind,'independent');assert.equal(byCode.star.roles[0].spaceName,'星光廳');
 assert.ok(!JSON.stringify(all).match(/password|hash/i));
 assert.deepEqual((await f.rpc('papa_management_account_list',[f.president,'星光',1])).rows.map(r=>r.loginCode),['star']);
 assert.deepEqual((await f.rpc('papa_management_account_list',[f.president,'fai',1])).rows.map(r=>r.name),['仙女']);
});

test('empty test streamer is permanently removed after confirmation; players, other streamers and history are preserved',async t=>{
 const f=await fixture(t);
 const created=await f.provision(f.president,{mode:'streamer',spaceId:'space-001',room:f.room('測試主播','test-host'),settings:f.settings(),loginEnabled:true},'test-pass-1');
 assert.ok(await f.streamerLogin(created.streamerId,'test-pass-1'));
 const players=JSON.stringify(await f.q("select * from papa_v2_entities where kind<>'meta' order by kind,id"));
 const others=(await f.meta()).streamers.filter(r=>r.id!==created.streamerId);
 const report=await f.review(f.president,'space-001',created.streamerId);
 assert.equal(report.safeToDelete,true);assert.deepEqual(report.blockers,[]);
 assert.ok(report.removes.some(r=>r.code==='DESCRIPTOR'));assert.ok(report.removes.some(r=>r.code==='ACCOUNT_LINK'));
 const payload={spaceId:'space-001',streamerId:created.streamerId,confirmationToken:report.confirmationToken,confirmedName:'測試主播'};
 await assert.rejects(f.remove(f.president,{...payload,confirmedName:'別的名字'}),/NAME_MISMATCH/);
 await assert.rejects(f.remove(f.president,{...payload,confirmationToken:'stale'}),/PREVIEW_STALE/);
 await assert.rejects(f.remove(f.outsider,payload),/ACCESS_DENIED/);
 const op=randomUUID(),result=await f.remove(f.president,payload,op);
 assert.deepEqual(result,{deleted:true,kind:'streamer',spaceId:'space-001',streamerId:created.streamerId,name:'測試主播'});
 assert.deepEqual(await f.remove(f.president,payload,op),result,'replay is idempotent');
 const meta=await f.meta();
 assert.ok(!meta.streamers.some(r=>r.id===created.streamerId));assert.ok(!(created.streamerId in meta.streamerSettings));
 assert.deepEqual(meta.streamers,others,'other streamers unchanged');
 assert.equal(JSON.stringify(await f.q("select * from papa_v2_entities where kind<>'meta' order by kind,id")),players,'players and business rows unchanged');
 assert.ok((await f.q('select deleted_at from papa_space_streamers where streamer_id=$1',[created.streamerId]))[0].deleted_at);
 assert.equal((await f.q('select count(*)::int n from papa_streamer_accounts where streamer_id=$1',[created.streamerId]))[0].n,0);
 assert.equal((await f.q('select count(*)::int n from papa_space_memberships where streamer_id=$1',[created.streamerId]))[0].n,0);
 assert.ok((await f.q('select disabled_at from papa_accounts where id=$1',[created.accountId]))[0].disabled_at,'orphan streamer Account is disabled, not deleted');
 assert.equal(await f.streamerLogin(created.streamerId,'test-pass-1'),null,'deleted streamer can no longer log in');
 const archive=(await f.q('select * from papa_management_deletions where operation_id=$1',[op]))[0];
 assert.equal(archive.target_kind,'streamer');assert.equal(archive.removed.streamer.descriptor.slug,'test-host');
 assert.ok(!JSON.stringify(archive).includes('test-pass-1')&&!JSON.stringify(archive).includes('$2'),'no password or hash archived');
 assert.ok((await f.q("select count(*)::int n from papa_events where streamer_id=$1",[created.streamerId]))[0].n>0,'event history kept');
 await assert.rejects(f.q('delete from papa_management_deletions'),/IMMUTABLE/);
 await assert.rejects(f.q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,'space-001','streamer_admin',$2)",[f.president,created.streamerId]),/STREAMER_DELETED/);
 await assert.rejects(f.q("insert into papa_v2_entities(kind,id,data) values('songs','ghost',$1)",[{songId:'ghost',streamer_id:created.streamerId,title:'T',artist:'A'}]),/STREAMER_DELETED/);
 // The released login code can be used again by a new streamer.
 assert.ok(await f.provision(f.president,{mode:'streamer',spaceId:'space-001',room:f.room('新主播','test-host'),settings:f.settings()}));
});

test('streamers with business data, player data, unknown relations or the original streamer are never deleted',async t=>{
 const f=await fixture(t);
 const busy=await f.provision(f.president,{mode:'streamer',spaceId:'space-001',room:f.room('有資料主播','busy'),settings:f.settings()});
 await f.q("insert into papa_v2_entities(kind,id,data) values('songs','busy-song',$1)",[{songId:'busy-song',streamer_id:busy.streamerId,title:'T',artist:'A'}]);
 const report=await f.review(f.president,'space-001',busy.streamerId);
 assert.equal(report.safeToDelete,false);assert.deepEqual(report.blockers.map(b=>b.code),['BUSINESS:songs']);assert.equal(report.blockers[0].label,'歌本歌曲');
 const before=JSON.stringify([await f.meta(),await f.q('select * from papa_v2_entities order by kind,id')]);
 await assert.rejects(f.remove(f.president,{spaceId:'space-001',streamerId:busy.streamerId,confirmationToken:report.confirmationToken,confirmedName:'有資料主播'}),/DEPENDENCIES_PRESENT/);
 assert.equal(JSON.stringify([await f.meta(),await f.q('select * from papa_v2_entities order by kind,id')]),before);
 const referenced=await f.provision(f.president,{mode:'streamer',spaceId:'space-001',room:f.room('玩家紀錄','ref'),settings:f.settings()});
 await f.q("update papa_v2_entities set data=jsonb_set(data,'{lastRoom}',to_jsonb($1::text)) where kind='players' and id='P1'",[referenced.streamerId]);
 assert.deepEqual((await f.review(f.president,'space-001',referenced.streamerId)).blockers.map(b=>b.code),['DATA:player_json']);
 const unknown=await f.provision(f.president,{mode:'streamer',spaceId:'space-001',room:f.room('未知關聯','unknown'),settings:f.settings()});
 await f.db.exec('create table papa_future_payouts(streamer_id text,amount int)');await f.q('insert into papa_future_payouts values($1,5)',[unknown.streamerId]);
 assert.deepEqual((await f.review(f.president,'space-001',unknown.streamerId)).blockers.map(b=>b.code),['UNKNOWN:papa_future_payouts']);
 assert.deepEqual((await f.review(f.president,'space-001','papa')).blockers.map(b=>b.code).slice(0,2),['PROTECTED','BUSINESS:songs']);
 assert.deepEqual((await f.review(f.president,'space-001')).blockers.map(b=>b.code)[0],'PROTECTED');
});

test('halls list affected streamers and are never cascaded; empty halls and independent Spaces are removed into reserved tombstones',async t=>{
 const f=await fixture(t);
 const hall=await f.hallCreate('待刪除廳');
 const host=await f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('廳內甲','hall-a'),settings:f.settings(),loginEnabled:true},'hall-pass-1');
 const blocked=await f.review(f.president,hall);
 assert.equal(blocked.safeToDelete,false);assert.equal(blocked.blockers[0].code,'HAS_STREAMERS');assert.match(blocked.blockers[0].label,/廳內甲/);
 assert.deepEqual(blocked.affectedStreamers.map(s=>s.name),['廳內甲']);
 await assert.rejects(f.remove(f.president,{spaceId:hall,confirmationToken:blocked.confirmationToken,confirmedName:'待刪除廳'}),/DEPENDENCIES_PRESENT/);
 assert.equal((await f.q('select deleted_at from papa_space_streamers where streamer_id=$1',[host.streamerId]))[0].deleted_at,null,'no cascade');
 const hostReview=await f.review(f.president,hall,host.streamerId);
 await f.remove(f.president,{spaceId:hall,streamerId:host.streamerId,confirmationToken:hostReview.confirmationToken,confirmedName:'廳內甲'});
 const empty=await f.review(f.president,hall);assert.equal(empty.safeToDelete,true);
 await f.remove(f.president,{spaceId:hall,confirmationToken:empty.confirmationToken,confirmedName:'待刪除廳'});
 const [space]=await f.q('select status,deleted_at from papa_spaces where id=$1',[hall]);assert.equal(space.status,'suspended');assert.ok(space.deleted_at);
 assert.ok((await f.q('select count(*)::int n from papa_management_audit where space_id=$1',[hall]))[0].n>=3,'management history kept');
 await assert.rejects(f.q("update papa_spaces set display_name='復活' where id=$1",[hall]),/SPACE_DELETED/);
 await assert.rejects(f.rpc('papa_manage_space',[f.president,randomUUID(),'edit',{spaceId:hall,revision:99,name:'復活'}]),/SPACE_DELETED|VERSION_CONFLICT/);
 await assert.rejects(f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('不可加入','late'),settings:f.settings()}),/SPACE_NOT_FOUND/);
 const directory=await f.rpc('papa_space_center_directory',[f.president,'all','',1,null]);
 assert.ok(!directory.rows.some(r=>r.id===hall));
 // Independent: deleting the Space explicitly lists and removes its own single streamer.
 const fairy=await f.provision(f.president,{mode:'independent',spaceName:'測試仙女',room:f.room('測試仙女','test-fairy'),settings:f.settings(),loginEnabled:true},'fairy-pass-1');
 const fairyReview=await f.review(f.president,fairy.spaceId);
 assert.equal(fairyReview.safeToDelete,true);assert.equal(fairyReview.alsoRemovesStreamer.name,'測試仙女');
 const shengma=JSON.stringify((await f.meta()).streamers.filter(r=>r.id!==fairy.streamerId));
 await f.remove(f.president,{spaceId:fairy.spaceId,confirmationToken:fairyReview.confirmationToken,confirmedName:'測試仙女'});
 assert.ok(!(await f.meta()).streamers.some(r=>r.id===fairy.streamerId));
 assert.equal(JSON.stringify((await f.meta()).streamers),shengma,'聲瑪 streamers untouched');
 assert.equal(await f.streamerLogin(fairy.streamerId,'fairy-pass-1'),null);
 assert.equal((await f.rpc('papa_management_account_list',[f.president,'',1])).total,1,'only the president remains as an active management Account');
});

test('space centre directory exposes login readiness and hides deleted rows',async t=>{
 const f=await fixture(t);
 const hall=await f.hallCreate('目錄廳');
 const withLogin=await f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('有帳號','has-login'),settings:f.settings(),loginEnabled:true},'dir-pass-1');
 await f.provision(f.president,{mode:'streamer',spaceId:hall,room:f.room('無帳號','no-login'),settings:f.settings()});
 const page=await f.rpc('papa_space_center_directory',[f.president,'hall','',1,hall]);
 const byName=Object.fromEntries(page.rows.map(r=>[r.name,r]));
 assert.deepEqual([byName['有帳號'].loginEnabled,byName['有帳號'].accountReady,byName['無帳號'].loginExists,byName['無帳號'].accountReady],[true,true,false,false]);
 assert.equal(byName['有帳號'].operational,false);
 const listing=await f.rpc('papa_space_center_directory',[f.president,'all','',1,null]);
 const shengma=listing.rows.find(r=>r.id==='space-001');assert.equal(shengma.operational,true);
 const created=listing.rows.find(r=>r.id===hall);assert.equal(created.provisioningPending,true);
 const r=await f.review(f.president,hall,withLogin.streamerId);
 await f.remove(f.president,{spaceId:hall,streamerId:withLogin.streamerId,confirmationToken:r.confirmationToken,confirmedName:'有帳號'});
 assert.deepEqual((await f.rpc('papa_space_center_directory',[f.president,'hall','',1,hall])).rows.map(r=>r.name),['無帳號']);
});
