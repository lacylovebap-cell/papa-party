import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

async function fixture(t) {
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('create role anon;create role authenticated;create role service_role;create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,24);');
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec("create table papa_manager_account_links(manager_key text primary key,account_id uuid unique references papa_accounts(id));create table papa_streamer_accounts(streamer_id text primary key,enabled boolean not null default true);create table papa_events(streamer_id text,secret text);create table papa_public_route_aliases(space_id text,streamer_id text,path text);insert into papa_spaces(id,slug,display_name) values('hall-b','hall-b','Hall B');insert into papa_space_streamers(streamer_id,space_id) values('room-a','space-001'),('room-b','hall-b');");
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1)",[{streamers:[{id:'papa',slug:'papa',display_name:'Papa',active:true},{id:'room-a',slug:'room-a',display_name:'Room A',active:false},{id:'room-b',slug:'room-b',display_name:'Room B',active:false}],streamerSettings:{'room-a':{livePrice:1200}}}]);
 // A second meta entity must never duplicate the canonical registry.
 await q("insert into papa_v2_entities(kind,id,data) values('meta','unrelated',$1)",[{streamers:[{id:'room-a',slug:'room-a',display_name:'Wrong duplicate',active:false}]}]);
 await db.exec(fs.readFileSync('ops/platform-management-proposed.sql','utf8'));
 await db.exec(fs.readFileSync('ops/platform-management-directory-proposed.sql','utf8'));
 await db.exec(fs.readFileSync('ops/platform-management-commit-proposed.sql','utf8'));
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const president=await account(),owner=await account(),delegate=await account(),outsider=await account();
 await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 await q("update papa_spaces set owner_account_id=$1 where id='space-001'",[owner]);
 const run=(who,action,payload,operation=randomUUID())=>q('select papa_manage_space($1,$2,$3,$4) result',[who,operation,action,payload]).then(r=>r[0].result);
 const directory=(who,section='streamers',search='',page=1)=>q('select papa_management_directory($1,$2,$3,$4) result',[who,section,search,page]).then(r=>r[0].result);
 const detail=(who,space='space-001',room=null,search='',page=1)=>q('select papa_management_detail($1,$2,$3,$4,$5) result',[who,space,room,search,page]).then(r=>r[0].result);
 return {db,q,run,directory,detail,president,owner,delegate,outsider,account};
}

test('business commit rechecks revoked permissions and rolls back failed writes in one transaction',async t=>{
 const {db,q,run,president,delegate}=await fixture(t);
 await db.exec(`create table commit_probe(value jsonb);
 create function papa_room_admin_commit(expected bigint,changes jsonb,removed jsonb,actor_context jsonb,notices jsonb,requested_room text)
 returns bigint language plpgsql as $$ begin insert into public.commit_probe values(changes);if expected=99 then raise exception 'PROBE_FAILURE';end if;return expected+1;end;$$;`);
 await run(president,'membership',{spaceId:'space-001',revision:0,accountId:delegate,role:'streamer_admin',streamerId:'room-a',permissions:['songs'],status:'active'});
 const args={expected:1,changes:[],removed:[],notices:[],requested_room:'room-a',actor_context:{role:'streamer_admin',account_id:delegate,actor_streamer_id:'room-a',streamer_id:'room-a',space_id:'space-001',action:'song'}};
 const call=(a=args,name='papa_room_admin_commit')=>q('select papa_management_business_commit($1,$2) result',[name,a]);
 assert.equal((await call())[0].result,2);
 await assert.rejects(call({...args,expected:99}),/PROBE_FAILURE/);
 assert.equal((await q('select count(*)::int n from commit_probe'))[0].n,1);
 await assert.rejects(call({...args,requested_room:'room-b'}),/ACCESS_DENIED/);
 await assert.rejects(call(args,'papa_manage_space'),/COMMIT_INVALID/);
 await run(president,'membership',{spaceId:'space-001',revision:1,accountId:delegate,role:'streamer_admin',streamerId:'room-a',permissions:[],status:'active'});
 await assert.rejects(call(),/ACCESS_DENIED/);
 assert.equal((await q('select count(*)::int n from commit_probe'))[0].n,1);
 await db.exec('set role anon');
 await assert.rejects(call(),/permission denied/);
});

test('non-commit RPC guard preserves typed named arguments and rejects cross-room or forged context',async t=>{
 const {db,q,run,president,delegate}=await fixture(t);
 await db.exec(`create table guarded_probe(value jsonb);
 create function papa_achievement_manual_grant(requested_space text,requested_room text,actor_context jsonb,requested_player text,requested_code text,requested_reason text,requested_show_day date)
 returns jsonb language plpgsql set search_path=public as $$ begin insert into guarded_probe values(actor_context);return jsonb_build_object('player',requested_player,'day',requested_show_day);end;$$;
 create function papa_catalog_batch_add(room_id text,variant_ids text[],lyrics_mode text,actor_id text)
 returns jsonb language sql as $$ select to_jsonb(variant_ids) $$;`);
 await run(president,'membership',{spaceId:'space-001',revision:0,accountId:delegate,role:'streamer_admin',streamerId:'room-a',permissions:['players','songs'],status:'active'});
 const ctx={role:'streamer_admin',account_id:delegate,space_id:'space-001',actor_streamer_id:'room-a'};
 const body={requested_space:'space-001',requested_room:'room-a',actor_context:ctx,requested_player:'p',requested_code:'P01',requested_reason:'verified',requested_show_day:'2026-10-21'};
 const call=(name,args,c=ctx)=>q('select papa_management_guarded_rpc($1,$2,$3) result',[name,args,c]);
 assert.deepEqual((await call('papa_achievement_manual_grant',body))[0].result,{player:'p',day:'2026-10-21'});
 assert.deepEqual((await call('papa_catalog_batch_add',{room_id:'room-a',variant_ids:['v1','v2'],lyrics_mode:'shared',actor_id:'verified:'+JSON.stringify(ctx)}))[0].result,['v1','v2']);
 await assert.rejects(call('papa_achievement_manual_grant',{...body,requested_room:'room-b'}),/ACCESS_DENIED/);
 await assert.rejects(call('papa_achievement_manual_grant',{...body,unexpected:'x'}),/SIGNATURE_INVALID/);
 await assert.rejects(call('papa_achievement_manual_grant',{...body,actor_context:{...ctx,account_id:president}}),/ACCESS_DENIED/);
 await run(president,'membership',{spaceId:'space-001',revision:1,accountId:delegate,role:'streamer_admin',streamerId:'room-a',permissions:['songs'],status:'active'});
 await assert.rejects(call('papa_achievement_manual_grant',body),/ACCESS_DENIED/);
 assert.equal((await q('select count(*)::int n from guarded_probe'))[0].n,1);
});

test('existing hall suspend/restore preserves business rows; newly created tenants cannot activate',async t=>{
 const f=await fixture(t),{q,run,president,owner}=f;
 await q("insert into papa_v2_entities(kind,id,data) values('ledger','keep',$1)",[{streamer_id:'room-a',playerId:'private-player',delta:3,note:'unchanged'}]);
 const before=(await q("select * from papa_v2_entities where kind='ledger'"))[0];
 await assert.rejects(run(owner,'suspend',{spaceId:'space-001',revision:0}),/ACCESS_DENIED/);
 const suspended=await run(president,'suspend',{spaceId:'space-001',revision:0});assert.equal(suspended.status,'suspended');assert.equal(suspended.management_revision,1);
 await assert.rejects(run(owner,'edit',{spaceId:'space-001',revision:1,name:'forbidden'}),/ACCESS_DENIED/);
 const restored=await run(president,'restore',{spaceId:'space-001',revision:1});assert.equal(restored.status,'active');assert.equal(restored.management_revision,2);
 const created=await run(president,'create',{name:'Pending tenant',kind:'hall',ownerAccountId:owner});
 await assert.rejects(run(president,'restore',{spaceId:created.id,revision:0}),/PROVISIONING_REQUIRED/);
 assert.deepEqual((await q("select * from papa_v2_entities where kind='ledger'"))[0],before);
 assert.equal((await q("select tenant_kind from papa_spaces where id='space-001'"))[0].tenant_kind,null);
});

test('archive is scoped, idempotent, requires disabled streamer and preserves aliases/history',async t=>{
 const {q,run,president,owner}=await fixture(t);
 await q("insert into papa_public_route_aliases values('space-001','room-a','/old-room')");
 const before=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 await assert.rejects(run(owner,'archive_streamer',{spaceId:'space-001',streamerId:'papa',revision:0}),/DISABLE_BEFORE_ARCHIVE/);
 await assert.rejects(run(owner,'archive_streamer',{spaceId:'space-001',streamerId:'room-b',revision:0}),/SCOPE_INVALID/);
 const operation=randomUUID(),payload={spaceId:'space-001',streamerId:'room-a',revision:0};
 const archived=await run(owner,'archive_streamer',payload,operation);assert.ok(archived.archived_at);
 assert.deepEqual(await run(owner,'archive_streamer',payload,operation),archived);
 assert.equal((await q("select count(*) n from papa_management_audit where action='archive_streamer'"))[0].n,1);
 const current=(await q("select management_revision from papa_spaces where id='space-001'"))[0].management_revision;
 await assert.rejects(q("update papa_v2_entities set data=jsonb_set(data,'{streamers,1,active}','true'::jsonb) where kind='meta' and id='1'"),/STREAMER_ARCHIVED/);
 assert.deepEqual((await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data,before);
 assert.equal((await q('select count(*) n from papa_public_route_aliases'))[0].n,1);
 const restored=await run(president,'restore_streamer',{...payload,revision:current});assert.equal(restored.archived_at,null);
 assert.equal((await q("select data->'streamers'->1->>'active' active from papa_v2_entities where kind='meta' and id='1'"))[0].active,'false');
});

test('streamer grants use existing Accounts and enforce exact Space/role/permitted-subset boundaries',async t=>{
 const {q,run,owner,delegate,outsider}=await fixture(t);
 await run(owner,'membership',{spaceId:'space-001',revision:0,accountId:delegate,status:'active',permissions:['songs','administrators']});
 await assert.rejects(run(delegate,'membership',{spaceId:'space-001',revision:1,accountId:outsider,status:'active',role:'streamer_admin',streamerId:'room-b',permissions:['songs']}),/SCOPE_INVALID/);
 await assert.rejects(run(delegate,'membership',{spaceId:'space-001',revision:1,accountId:outsider,status:'active',role:'streamer_admin',streamerId:'room-a',permissions:['reports']}),/ESCALATION/);
 await assert.rejects(run(owner,'membership',{spaceId:'space-001',revision:1,accountId:outsider,status:'active',role:'streamer_admin',streamerId:'room-a',permissions:['administrators']}),/PERMISSION_INVALID/);
 const op=randomUUID(),payload={spaceId:'space-001',revision:1,accountId:outsider,status:'active',role:'streamer_admin',streamerId:'room-a',permissions:['songs']};
 const granted=await run(delegate,'membership',payload,op);assert.equal(granted.role,'streamer_admin');assert.equal(granted.streamer_id,'room-a');
 assert.deepEqual(await run(delegate,'membership',payload,op),granted);
 const access=async(room,permission)=>(await q('select papa_management_access($1,$2,$3,$4) allowed',[outsider,'space-001',room,permission]))[0].allowed;
 assert.equal(await access('room-a','songs'),true);assert.equal(await access('papa','songs'),false);assert.equal(await access('room-a','queue'),false);
 await run(owner,'membership',{...payload,revision:2,status:'suspended'});assert.equal(await access('room-a','songs'),false);
 await run(owner,'membership',{spaceId:'space-001',revision:3,accountId:delegate,status:'suspended',permissions:['songs','administrators']});
 await assert.rejects(run(delegate,'membership',payload,op),/ACCESS_DENIED/); // a revoked actor cannot replay an old grant
 assert.equal((await q('select count(*) n from papa_accounts'))[0].n,4);
});

test('management directory uses canonical meta only, stays scoped, paginates and labels bound accounts',async t=>{
 const {q,run,directory,detail,president,owner,delegate}=await fixture(t);
 const a=await directory(president);assert.equal(a.registryRevision,24);assert.equal(a.rows.filter(r=>r.id==='room-a').length,1);assert.equal(a.rows.find(r=>r.id==='room-a').descriptor.display_name,'Room A');
 const scoped=await directory(owner);assert.deepEqual(scoped.rows.map(r=>r.spaceId),['space-001','space-001']);
 await assert.rejects(detail(owner,'hall-b','room-b'),/ACCESS_DENIED/);
 const counts=(await directory(owner,'overview')).summary;assert.equal(counts.spaces,1);assert.equal(counts.streamers,2);
 await q("insert into papa_v2_entities(kind,id,data) values('players','verified-player',$1)",[{name:'Verified player',password:'never send'}]);
 await q("insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,'verified-player')",[delegate]);
 await run(owner,'membership',{spaceId:'space-001',revision:0,accountId:delegate,status:'active',permissions:['songs']});
 const accounts=await directory(owner,'accounts');assert.equal(accounts.rows[0].name,'Verified player');assert.equal(JSON.stringify(accounts).includes('never send'),false);
 const info=await detail(owner,'space-001','room-a');assert.equal(info.streamer.settings.livePrice,1200);assert.equal(info.memberships[0].name,'Verified player');assert.equal(info.canManageMemberships,true);
 await q("insert into papa_spaces(id,slug,display_name) select 'extra-'||n,'extra-'||n,'Extra '||lpad(n::text,2,'0') from generate_series(1,25)n");
 const page=await directory(president,'halls','Extra',2);assert.equal(page.rows.length,5);assert.equal(page.total,25);assert.equal(page.pages,2);assert.equal(page.page,2);
 const clamped=await directory(president,'halls','Extra',999);assert.equal(clamped.page,2);
 const none=await directory(president,'halls','missing',999);assert.equal(none.page,1);assert.equal(none.pages,1);assert.deepEqual(none.rows,[]);
});

test('cleanup review returns only counts, reports unexamined links and never authorizes deletion',async t=>{
 const {q,president,outsider}=await fixture(t);
 await q("insert into papa_events values('room-a','private audit text')");
 await q("insert into papa_v2_entities(kind,id,data) values('queue','queue-keep',$1)",[{streamer_id:'room-a',playerId:'private',note:'secret-message'}]);
 const review=(who,space,room)=>q('select papa_management_dependencies($1,$2,$3) data',[who,space,room]).then(r=>r[0].data);
 const result=await review(president,'space-001','room-a');assert.equal(result.entityCounts.queue,1);assert.equal(result.entityCounts.ledger,0);assert.equal(result.auditPresent,true);assert.equal(result.safeToDelete,false);assert.equal(result.permanentDeleteAuthorized,false);assert.ok(result.unchecked.length>=8);
 assert.equal(JSON.stringify(result).includes('secret-message'),false);assert.equal(JSON.stringify(result).includes('private audit text'),false);
 await assert.rejects(review(outsider,'space-001','room-a'),/ACCESS_DENIED/);
 await assert.rejects(review(president,'space-001','room-b'),/ACCESS_DENIED/);
 const empty=await review(president,'space-001','papa');assert.equal(empty.safeToDelete,false);assert.equal(empty.auditPresent,false);
});

test('legacy room authority is preserved until explicit grant editing, then only selected permissions remain',async t=>{
 const {q,run,detail,owner,delegate,outsider}=await fixture(t);
 await q("insert into papa_manager_account_links(manager_key,account_id) values('streamer:room-a',$1)",[delegate]);
 await q("insert into papa_streamer_accounts values('room-a',true)");
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,'space-001','streamer_admin','room-a')",[delegate]);
 const allowed=async(who,room,permission)=>(await q('select papa_management_room_permission($1,$2,$3) allowed',[who,room,permission]))[0].allowed;
 assert.equal(await allowed(delegate,'room-a','songs'),true);assert.equal(await allowed(delegate,'room-a','queue'),true);assert.equal(await allowed(delegate,'room-a','all'),true);
 assert.equal(await allowed(delegate,'room-b','songs'),false);assert.equal(await allowed(delegate,'room-a','administrators'),false);
 const initial=await detail(owner,'space-001','room-a');assert.equal(initial.memberships[0].name,'Room A');assert.equal(initial.memberships[0].permissionsExplicit,false);assert.ok(initial.memberships[0].effectivePermissions.includes('queue'));
 await run(owner,'membership',{spaceId:'space-001',revision:0,accountId:delegate,status:'active',role:'streamer_admin',streamerId:'room-a',permissions:['songs']});
 assert.equal(await allowed(delegate,'room-a','songs'),true);assert.equal(await allowed(delegate,'room-a','queue'),false);assert.equal(await allowed(delegate,'room-a','all'),false);
 assert.equal((await detail(owner,'space-001','room-a')).memberships[0].permissionsExplicit,true);
 await run(owner,'membership',{spaceId:'space-001',revision:1,accountId:delegate,status:'active',role:'streamer_admin',streamerId:'room-a',permissions:['songs','queue','players','announcements','reports']});
 assert.equal(await allowed(delegate,'room-a','all'),true);
 await q("insert into papa_space_memberships(account_id,space_id,role) values($1,'space-001','space_admin')",[outsider]);
 assert.equal(await allowed(outsider,'room-a','songs'),false); // no implicit hall-wide role upgrade
 await q('update papa_accounts set disabled_at=now() where id=$1',[delegate]);assert.equal(await allowed(delegate,'room-a','songs'),false);
});

test('stale revisions and Audit failure roll back fully; Audit and RPCs are inaccessible to browser roles',async t=>{
 const {db,q,run,president,owner}=await fixture(t);
 const results=await Promise.allSettled([run(owner,'edit',{spaceId:'space-001',revision:0,name:'First'}),run(owner,'edit',{spaceId:'space-001',revision:0,name:'Second'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/VERSION_CONFLICT/);
 await assert.rejects(q("update papa_management_audit set action='forged'"),/AUDIT_IMMUTABLE/);
 await assert.rejects(q('delete from papa_management_audit'),/AUDIT_IMMUTABLE/);
 await db.exec("create function fail_archive_audit() returns trigger language plpgsql as $$begin if new.action='archive_streamer' then raise exception 'archive audit failed';end if;return new;end$$;create trigger fail_archive_audit before insert on papa_management_audit for each row execute function fail_archive_audit();");
 await assert.rejects(run(president,'archive_streamer',{spaceId:'space-001',revision:1,streamerId:'room-a'}),/archive audit failed/);
 assert.equal((await q("select archived_at from papa_space_streamers where streamer_id='room-a'"))[0].archived_at,null);
 assert.equal((await q("select management_revision from papa_spaces where id='space-001'"))[0].management_revision,1);
 for(const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  await assert.rejects(q('select * from papa_management_audit'),/permission denied/);
  await assert.rejects(q("select papa_management_access($1,'space-001','room-a','songs')",[president]),/permission denied/);
  await assert.rejects(q("select papa_management_room_permission($1,'room-a','songs')",[president]),/permission denied/);
  await assert.rejects(q("select papa_management_directory($1,'overview','',1)",[president]),/permission denied/);
  await assert.rejects(q("select papa_management_detail($1,'space-001',null,'',1)",[president]),/permission denied/);
  await assert.rejects(q("select papa_management_dependencies($1,'space-001','room-a')",[president]),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 assert.equal((await q("select papa_management_directory($1,'overview','',1) data",[president]))[0].data.summary.spaces,2);
 await assert.rejects(q('select * from papa_management_audit'),/permission denied/); // RPC access is not direct table access
 await db.exec('reset role');
});
