import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const testId='17a9d873-e04c-4a6c-a453-cddb5b1caf65';
async function fixture(t) {
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('create role anon;create role authenticated;create role service_role;create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,24)');
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec('create table papa_manager_account_links(manager_key text primary key,account_id uuid unique references papa_accounts(id))');
 await q("insert into papa_v2_entities values('meta','1',$1,null)",[{streamers:[{id:'papa',slug:'papa',display_name:'Formal room',active:true},{id:testId,slug:'test-only',display_name:'Empty test',active:false}],streamerSettings:{papa:{livePrice:1000},[testId]:{livePrice:700}}}]);
 await db.exec(fs.readFileSync('ops/platform-management-proposed.sql','utf8'));
 await db.exec(fs.readFileSync('ops/test-streamer-delete-proposed.sql','utf8'));
 const president=(await q('insert into papa_accounts default values returning id'))[0].id;
 const outsider=(await q('insert into papa_accounts default values returning id'))[0].id;
 await q("insert into papa_platform_roles values($1,'president',now())",[president]);
 await q("insert into papa_manager_account_links values('president',$1)",[president]);
 await q('update papa_space_streamers set archived_at=now() where streamer_id=$1',[testId]);
 const review=(who=president,room=testId,space='space-001')=>q('select papa_test_streamer_delete_review($1,$2,$3) value',[who,space,room]).then(rows=>rows[0].value);
 const remove=(token,name='Empty test',op=randomUUID(),who=president)=>q('select papa_test_streamer_delete_empty_prototype($1,$2,$3,$4,$5,$6) value',[who,op,'space-001',testId,token,name]).then(rows=>rows[0].value);
 return {db,q,president,outsider,review,remove};
}

test('review requires verified president role and binding; no browser may select another Account',async t=>{
 const {db,q,president,outsider,review}=await fixture(t);
 await assert.rejects(review(outsider),/ACCESS_DENIED/);
 await q('delete from papa_manager_account_links where account_id=$1',[president]);
 await assert.rejects(review(),/ACCESS_DENIED/);
 await q("insert into papa_manager_account_links values('president',$1)",[president]);
 await db.exec('set role anon');await assert.rejects(review(),/permission denied/);
 await db.exec('reset role;set role authenticated');await assert.rejects(review(),/permission denied/);
});

test('review permits only identified inactive archived test candidates, never a formal room with a test-like name',async t=>{
 const {q,review}=await fixture(t);
 const empty=await review();assert.equal(empty.safeToDelete,true);assert.equal(empty.permanentDeleteAuthorized,false);assert.equal(empty.requiresExplicitApproval,true);
 const formal=await review(undefined,'papa');assert.ok(formal.blockers.includes('NOT_APPROVED_TEST_CANDIDATE'));assert.ok(formal.blockers.includes('DISABLE_BEFORE_DELETE'));assert.ok(formal.blockers.includes('ARCHIVE_BEFORE_DELETE'));
 await q('update papa_space_streamers set archived_at=null where streamer_id=$1',[testId]);
 assert.ok((await review()).blockers.includes('ARCHIVE_BEFORE_DELETE'));
 await assert.rejects(review(undefined,testId,'wrong-hall'),/SCOPE_INVALID/);
});

test('known business, favorite, medal and message dependencies produce capped counts without private content',async t=>{
 const {db,q,review}=await fixture(t);
 await db.exec('create table papa_song_favorites(streamer_id text,private_name text);create table papa_chat_messages(streamer_id text,body text);create table papa_achievement_awards(streamer_id text,player_id text)');
 await q("insert into papa_v2_entities(kind,id,data) values('ledger','retain-ledger',$1)",[{streamer_id:testId,amount:3,note:'PRIVATE ledger'}]);
 await q('insert into papa_song_favorites values($1,$2)',[testId,'PRIVATE player']);
 await q('insert into papa_chat_messages values($1,$2)',[testId,'PRIVATE conversation']);
 await q('insert into papa_achievement_awards values($1,$2)',[testId,'PRIVATE medal owner']);
 const result=await review();assert.equal(result.safeToDelete,false);
 assert.ok(result.blockers.includes('BUSINESS_DATA:ledger'));
 for(const table of ['papa_song_favorites','papa_chat_messages','papa_achievement_awards']) assert.ok(result.blockers.includes('DEPENDENCY:'+table));
 assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 await db.exec("insert into papa_chat_messages select '"+testId+"','private' from generate_series(1,1100)");
 const capped=(await review()).dependencies.find(x=>x.relation==='papa_chat_messages');assert.equal(capped.count,1000);assert.equal(capped.capped,true);
});

test('unknown tables, backup bodies, player JSON and changed schema fail closed without downloading their text',async t=>{
 const {db,q,review}=await fixture(t),before=await review();
 await q("insert into papa_v2_entities(kind,id,data) values('players','shared-player',$1)",[{name:'PRIVATE player',credits:{[testId]:4}}]);
 await db.exec('create table papa_future_relation(room_id text,body jsonb);create table papa_release_backups(release text,snapshot jsonb)');
 await q('insert into papa_release_backups values($1,$2)',['release-old',{body:'PRIVATE backup'}]);
 const result=await review();assert.equal(result.safeToDelete,false);assert.ok(result.unreviewed.includes('GLOBAL_PLAYER_JSON_REFERENCES'));assert.ok(result.unreviewed.includes('RELATION:papa_future_relation'));assert.ok(result.unreviewed.includes('RELATION:papa_release_backups'));
 assert.notEqual(before.schemaFingerprint,result.schemaFingerprint);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

test('prototype is uncallable in production mode and service role never receives EXECUTE',async t=>{
 const {db,review,remove}=await fixture(t),preview=await review();
 await assert.rejects(remove(preview.confirmationToken),/DELETE_PROTOTYPE_ONLY/);
 await db.exec("set papa.isolated_delete_fixture='true';set role service_role");
 await assert.rejects(remove(preview.confirmationToken),/permission denied/);
});

test('isolated empty delete removes only descriptor/settings/mapping, retains identity and Audit, and replays exactly once',async t=>{
 const {db,q,president,review,remove}=await fixture(t),preview=await review(),op=randomUUID();
 await db.exec("set papa.isolated_delete_fixture='true'");
 const result=await remove(preview.confirmationToken,'Empty test',op);assert.equal(result.deleted,true);assert.equal(result.isolatedPrototype,true);
 assert.deepEqual(await remove(preview.confirmationToken,'Empty test',op),result);
 await assert.rejects(remove(preview.confirmationToken,'Other name',op),/OPERATION_CONFLICT/);
 assert.equal((await q('select count(*)::int n from papa_accounts'))[0].n,2);
 assert.equal((await q('select count(*)::int n from papa_space_streamers where streamer_id=$1',[testId]))[0].n,0);
 assert.equal((await q("select count(*)::int n from papa_space_streamers where streamer_id='papa'"))[0].n,1);
 const meta=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 assert.deepEqual(meta.streamers.map(x=>x.id),['papa']);assert.deepEqual(meta.streamerSettings.papa,{livePrice:1000});assert.equal(Object.hasOwn(meta.streamerSettings,testId),false);
 assert.equal((await q("select count(*)::int n from papa_management_audit where action='delete_empty_test_streamer'"))[0].n,1);
 assert.equal((await q('select revision from papa_v2_revision where id=1'))[0].revision,25);
 await q('update papa_accounts set disabled_at=now() where id=$1',[president]);
 await assert.rejects(remove(preview.confirmationToken,'Empty test',op),/ACCESS_DENIED/);
});

test('changed revision, wrong name and newly added dependencies invalidate confirmation before any removal',async t=>{
 const {db,q,review,remove}=await fixture(t),preview=await review();
 await db.exec("set papa.isolated_delete_fixture='true'");
 await assert.rejects(remove(preview.confirmationToken,'Formal room'),/NAME_MISMATCH/);
 await q('update papa_v2_revision set revision=revision+1 where id=1');
 await assert.rejects(remove(preview.confirmationToken),/PREVIEW_STALE/);
 const refreshed=await review();
 await q("insert into papa_v2_entities(kind,id,data) values('queue','later-queue',$1)",[{streamer_id:testId,title:'do not delete'}]);
 await assert.rejects(remove(refreshed.confirmationToken),/PREVIEW_STALE/);
 assert.equal((await q('select count(*)::int n from papa_space_streamers where streamer_id=$1',[testId]))[0].n,1);
 assert.equal((await q('select count(*)::int n from papa_management_audit'))[0].n,0);
});

test('Audit failure rolls back registry removal, mapping and both revisions atomically',async t=>{
 const {db,q,review,remove}=await fixture(t),preview=await review();
 await db.exec("set papa.isolated_delete_fixture='true';create function reject_delete_audit() returns trigger language plpgsql as $$begin raise exception 'AUDIT_INSERT_FAILED';end$$;create trigger reject_delete_audit before insert on papa_management_audit for each row execute function reject_delete_audit()");
 const before=(await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data;
 await assert.rejects(remove(preview.confirmationToken),/AUDIT_INSERT_FAILED/);
 assert.deepEqual((await q("select data from papa_v2_entities where kind='meta' and id='1'"))[0].data,before);
 assert.equal((await q('select count(*)::int n from papa_space_streamers where streamer_id=$1',[testId]))[0].n,1);
 assert.equal((await q('select revision from papa_v2_revision where id=1'))[0].revision,24);
 assert.equal((await q("select management_revision from papa_spaces where id='space-001'"))[0].management_revision,0);
});

test('published URLs and existing Audit are preserved as deletion blockers',async t=>{
 const {db,q,review,remove}=await fixture(t);
 await db.exec('create table papa_public_route_aliases(streamer_id text,path text);create table papa_events(streamer_id text,before_data jsonb)');
 await q('insert into papa_public_route_aliases values($1,$2)',[testId,'/keep-old-qr']);
 await q('insert into papa_events values($1,$2)',[testId,{private:'never export or delete'}]);
 const preview=await review();assert.ok(preview.blockers.includes('DEPENDENCY:papa_public_route_aliases'));assert.ok(preview.blockers.includes('DEPENDENCY:papa_events'));
 await db.exec("set papa.isolated_delete_fixture='true'");await assert.rejects(remove(preview.confirmationToken),/DEPENDENCIES_PRESENT/);
 assert.equal((await q('select count(*)::int n from papa_events'))[0].n,1);assert.equal((await q('select path from papa_public_route_aliases'))[0].path,'/keep-old-qr');
});
