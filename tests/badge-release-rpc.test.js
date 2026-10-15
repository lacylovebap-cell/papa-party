import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_accounts(id uuid primary key,disabled_at timestamptz);
 create table papa_account_legacy_players(account_id uuid,legacy_player_id text);
 create table papa_space_player_profiles(space_id text,player_id text,account_id uuid,data jsonb);
 create table papa_v2_entities(kind text,id text,data jsonb,space_id text,primary key(kind,id));
 create table papa_spaces(id text primary key,status text,accounting_rollover_hour int);
 create table papa_v2_revision(id int primary key,revision bigint);
 insert into papa_v2_revision values(1,42);
 create table papa_space_streamers(streamer_id text,space_id text);
 create table papa_space_memberships(account_id uuid,space_id text,role text,status text);
 create function papa_streamer_directory() returns jsonb language sql as $$select '[{"id":"papa","spaceId":"space-001","display_name":"Pa","active":true},{"id":"other","spaceId":"space-002","display_name":"Other","active":true}]'::jsonb$$;
 create function papa_streamer_directory_in_space(s text) returns jsonb language sql as $$select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(papa_streamer_directory()) r where r->>'spaceId'=s$$;
 create table papa_events(id bigint generated always as identity primary key,streamer_id text,entity_kind text,entity_id text,
 action text,actor_role text,actor_player_id text,created_at timestamptz default now(),effective_at text,before_data jsonb,after_data jsonb,
 hour_bucket bigint,actor_account_id uuid,actor_streamer_id text,target_player_id text,space_id text);
 create unique index failed_hour on papa_events(streamer_id,actor_player_id,hour_bucket) where action='request_failed';
 create table papa_notifications(id uuid default gen_random_uuid(),streamer_id text,streamer_name text,recipient text,type text,level int,body text,entity_id text,space_id text);
 create function papa_accounting_time(value text) returns timestamptz language plpgsql immutable as $$begin return value::timestamptz;exception when others then return null;end$$;
 create function papa_notice_category_scope(s text,r text,a jsonb,m text) returns jsonb language plpgsql stable as $$begin
 if a->>'space_id' is distinct from s or a->>'role' not in ('player','streamer_admin','super_admin') then raise exception 'SCOPE_INVALID';end if;
 return jsonb_build_object('recipient',case a->>'role' when 'player' then a->>'player_id' when 'streamer_admin' then '__admin__' else '__super__' end);end$$;
 insert into papa_accounts values('11111111-1111-4111-8111-111111111111',null);
 insert into papa_space_memberships values('11111111-1111-4111-8111-111111111111','space-001','player','active'),('11111111-1111-4111-8111-111111111111','space-002','player','active');
 insert into papa_account_legacy_players values('11111111-1111-4111-8111-111111111111','P1');
 insert into papa_space_player_profiles values('space-002','P2','11111111-1111-4111-8111-111111111111','{"name":"one"}');
 insert into papa_spaces values('space-001','active',19),('space-002','active',19);
 insert into papa_space_streamers values('papa','space-001'),('other','space-002');
 insert into papa_v2_entities values('players','P1','{"name":"one"}',null),('meta','1','{"streamers":[{"id":"papa","display_name":"Pa"}]}',null);`);
 for(const file of ['202610140001_achievements.sql','202610140006_achievement_collection.sql','202610140007_achievement_public_choices.sql','202610140008_achievement_manual_certification.sql',
 '202610150100_badge_catalog.sql','202610150101_badge_award_rules.sql','202610150102_badge_failures_and_draws.sql','202610150103_badge_atlas.sql','202610150104_badge_rankings.sql','202610150105_badge_show_settlement.sql','202610150106_badge_release_replay.sql','202610150107_badge_draw_sources.sql'])
  await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const put=async(id,data,space='space-001')=>q("insert into papa_v2_entities values('queue',$1,$2,$3) on conflict(kind,id) do update set data=excluded.data",[id,data,space]);
 return {db,q,put};
}
const row=(i,extra={})=>({id:'Q'+i,playerId:'P1',streamer_id:'papa',kind:'live',source:'manual',title:'歌',artist:'甲',
 at:'2026-10-01T12:00:00Z',acceptedAt:'2026-10-01T12:00:00Z',status:'completed',
 completedAt:new Date(Date.parse('2026-10-01T13:00:00Z')+i*60000).toISOString(),...extra});
test('additive SQL catalog, global identity and historical exact 50th event preserve canonical facts',async t=>{
 const f=await fixture(t);
 for(let i=0;i<60;i++)await f.put('Q'+i,row(i,i%2?{playerId:'P2',streamer_id:'other',artist:'乙'}:{}),i%2?'space-002':'space-001');
 const before=await f.q('select kind,id,data,space_id from papa_v2_entities order by kind,id');
 const rows=await f.q("select * from papa_badge_global_candidates('space-001','P1','2026-10-15')");
 assert.equal(rows.length,3);assert.equal(new Date(rows.find(r=>r.code==='same10').acquired_at).toISOString(),row(49).completedAt);
 assert.equal((await f.q("select count(*)::int n from papa_achievement_catalog where badge_id is not null and not retired"))[0].n,57);
 assert.deepEqual(await f.q('select kind,id,data,space_id from papa_v2_entities order by kind,id'),before);
 assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,0,'read-only candidates do not create awards');
});
test('global P28 deduplicates keywords across accounts profiles and excludes dice/self completions',async t=>{
 const f=await fixture(t),tags=Array.from({length:19},(_,i)=>'tag'+i);
 await f.put('Q1',row(1,{achievement_tags:tags}));
 await f.put('Q2',row(2,{playerId:'P2',streamer_id:'other',achievement_tags:[' TAG0 ','tag19']}),'space-002');
 assert.ok((await f.q("select * from papa_badge_global_candidates('space-001','P1','2026-10-15')")).some(r=>r.code==='all_tags'));
 await f.put('Q2',row(2,{playerId:'P2',streamer_id:'other',source:'self',achievement_tags:['tag19']}),'space-002');
 assert.equal((await f.q("select * from papa_badge_global_candidates('space-001','P1','2026-10-15')")).length,0);
});
test('transactional candidate apply validates expiry, keeps historical acquisition, deduplicates writes and protects manual certification',async t=>{
 const f=await fixture(t),event=(await f.q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id) values('papa','achievement','source','fixture','system','space-001') returning id"))[0].id;
 const candidate={id:'P01',code:'first_live',playerId:'P1',period:'lifetime',active:false,acquiredAt:'2026-10-01T12:00:00Z',expiresAt:'2026-10-02T12:00:00Z'};
 const apply=async x=>f.q("select papa_badge_apply('space-001','papa',$1,$2)",[[x],event]);
 await apply(candidate);assert.equal((await f.q('select count(*)::int n from papa_achievement_awards'))[0].n,0);
 const permanent={...candidate,id:'P04',code:'big_requester',active:true,expiresAt:null};
 await apply(permanent);await apply(permanent);
 assert.equal((await f.q("select count(*)::int n from papa_events where entity_kind='achievement' and entity_id='big_requester'"))[0].n,1);
 const saved=(await f.q("select acquired_at,rule_version from papa_achievement_awards where code='big_requester'"))[0];
 assert.equal(new Date(saved.acquired_at).toISOString(),new Date(permanent.acquiredAt).toISOString());assert.equal(saved.rule_version,2);
 await f.q("update papa_achievement_awards set manual_verified=true where code='big_requester'");
 await apply({...permanent,active:false});assert.equal((await f.q("select active from papa_achievement_awards where code='big_requester'"))[0].active,true);
 await assert.rejects(apply({...candidate,active:true,acquiredAt:new Date().toISOString(),expiresAt:'2099-01-01T00:00:00Z'}),/BADGE_CANDIDATE_TIME_INVALID/);
});
test('atlas keeps exact Emoji, hides H conditions and all five deleted medals, and expires old automatic awards',async t=>{
 const f=await fixture(t);
 const result=(await f.q("select papa_achievement_page('space-001','papa','P1',$1) v",[{role:'player',space_id:'space-001',player_id:'P1'}]))[0].v;
 assert.equal(result.rows.filter(r=>r.badgeId).length,57);
 assert.equal(result.rows.find(r=>r.badgeId==='S03').emoji,'🛎');
 assert.equal(result.rows.find(r=>r.badgeId==='H01').condition,null);
 assert.equal(result.rows.find(r=>r.badgeId==='H01').name,'陰間作息');
 assert.ok(result.rows.find(r=>r.badgeId==='L02').condition.includes('0.1%'));
 assert.equal(result.rows.some(r=>['P09','P10','P24','P25','P26'].includes(r.badgeId)),false);
});
test('all held medal counts include private and hidden medals; public details keep publication choices',async t=>{
 const f=await fixture(t);
 const source=(await f.q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id) values('papa','achievement','source','fixture','system','space-001') returning id"))[0].id;
 for(const code of ['big_requester','insomnia','sweet3'])await f.q(`insert into papa_achievement_awards(space_id,streamer_id,player_id,code,period,active,acquired_at,source_event_id,rule_version)
 values('space-001','papa','P1',$1,'lifetime',true,now(),$2,2)`,[code,source]);
 const actor={role:'player',space_id:'space-001',player_id:'P1',account_id:'11111111-1111-4111-8111-111111111111'};
 const result=(await f.q("select papa_achievement_collection('space-001','papa',$1,'room') v",[actor]))[0].v;
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].total,2,'retired does not count; hidden and private do');
 assert.deepEqual(result.rows[0].preview,[]);
 const gallery=(await f.q("select papa_achievement_collection('space-001','papa',$1,'gallery','',0,$2,'papa') v",[actor,result.rows[0].player_key]))[0].v;
 assert.deepEqual(gallery.rows,[],'private count does not expose private medal details');
 const global=(await f.q("select papa_achievement_collection('space-001','papa',$1,'global') v",[actor]))[0].v;
 assert.deepEqual(global.rows,[],'room medals do not leak into global count');
});
test('song SQL ranking uses title plus artist and completed units only, excludes dice/self and supports specified-page reads',async t=>{
 const f=await fixture(t),actor={role:'player',space_id:'space-001',player_id:'P1'};
 const rows=[row(1),row(2,{artist:'乙'}),row(3,{title:'另一首'}),row(4,{source:'draw'}),row(5,{source:'self'}),
  row(6,{source:'cross_self'}),row(7,{source:'proxy_draw'}),row(8,{status:'waiting',completedAt:null})];
 for(const q of rows)await f.put(q.id,q);
 const result=(await f.q("select papa_achievement_collection('space-001','papa',$1,'songs_room') v",[actor]))[0].v;
 assert.equal(result.total,3);assert.deepEqual(result.rows.map(r=>r.total),[1,1,1]);assert.deepEqual(result.rows.map(r=>r.rank),[1,1,1]);
 const second=(await f.q("select papa_achievement_collection('space-001','papa',$1,'songs_room','',1) v",[actor]))[0].v;
 assert.equal(second.total,3);assert.deepEqual(second.rows,[]);assert.equal(second.page,1);
 await f.put('extra-a',row(9));await f.put('extra-b',row(10,{artist:'乙'}));
 const ties=(await f.q("select papa_achievement_collection('space-001','papa',$1,'songs_room') v",[actor]))[0].v;
 assert.deepEqual(ties.rows.map(r=>r.rank),[1,1,3]);
});
test('19:00 SQL settlement handles tied popular song, majority, last completion and two-show reunion; retry is idempotent',async t=>{
 const f=await fixture(t);
 await f.q("insert into papa_v2_entities values('players','P3',$1,null)",[{name:'other'}]);
 const at=(day,time)=>'2026-10-'+day+'T'+time+':00+08:00';
 await f.put('previous',row(1,{playerId:'P3',at:at('12','20:00'),completedAt:at('12','20:10'),title:'A'}));
 await f.put('head',row(2,{at:at('13','20:00'),completedAt:at('13','20:10'),title:'A'}));
 await f.put('popular',row(3,{playerId:'P3',at:at('13','20:01'),completedAt:at('13','20:11'),title:'A'}));
 await f.put('last',row(4,{at:at('13','20:02'),completedAt:at('13','20:12'),title:'B'}));
 const candidates=(await f.q("select papa_badge_show_candidates('space-001','papa','2026-10-13') v"))[0].v;
 assert.equal(candidates.length,4);
 assert.equal(candidates.find(r=>r.id==='P12').playerId,'P3');
 for(const id of ['H04','H06','H07'])assert.equal(candidates.find(r=>r.id===id).playerId,'P1');
 assert.equal((await f.q("select papa_badge_settle_show('space-001','papa','2026-10-13') n"))[0].n,4);
 assert.equal((await f.q("select papa_badge_settle_show('space-001','papa','2026-10-13') n"))[0].n,0);
 assert.equal((await f.q('select count(*)::int n from papa_badge_show_settlements'))[0].n,1);
 await f.q('select papa_badge_settle_due()');
});
test('release worker reads bounded selected-column keyset pages, rejects revision drift and idempotently applies historical candidates',async t=>{
 const f=await fixture(t);
 for(let i=0;i<102;i++)await f.put('Q'+String(i).padStart(3,'0'),row(i,{requestNote:'private-note',password:'secret',lyricNotes:'private-lyrics'}));
 const first=(await f.q("select papa_badge_replay_page('space-001','papa','queue','',42) v"))[0].v;
 assert.equal(first.rows.length,100);assert.equal(first.nextCursor,'Q099');assert.doesNotMatch(JSON.stringify(first),/private|secret|requestNote|password|lyric/);
 const second=(await f.q("select papa_badge_replay_page('space-001','papa','queue',$1,42) v",[first.nextCursor]))[0].v;
 assert.equal(second.rows.length,2);assert.equal(second.nextCursor,null);
 await assert.rejects(f.q("select papa_badge_replay_page('space-001','papa','queue','',41)"),/VERSION_CONFLICT/);
 const changes=[{id:'P04',code:'big_requester',playerId:'P1',period:'lifetime',active:true,acquiredAt:'2026-10-01T12:00:00Z',expiresAt:null}];
 const apply=()=>f.q("select papa_badge_replay_apply('space-001','papa',42,$1,$2) v",[['P1'],changes]);
 assert.equal((await apply())[0].v.ok,true);
 assert.equal((await apply())[0].v.alreadyRecorded,true);
 assert.equal((await f.q("select count(*)::int n from papa_events where action='achievement_release_rejudged'"))[0].n,1);
 assert.equal((await f.q('select revision from papa_v2_revision'))[0].revision,42);
 assert.equal((await f.q("select count(*)::int n from papa_v2_entities where kind='queue'"))[0].n,102);
 await f.db.exec(fs.readFileSync('ops/export-badge-replay.sql','utf8'));
 const exported=(await f.q('select pg_temp.papa_badge_export() v'))[0].v;
 assert.equal(exported.rooms.find(r=>r.streamerId==='papa').queue.length,102);
 assert.doesNotMatch(JSON.stringify(exported),/private-lyrics|private-note|secret/);
});
test('new receipt/live draw events are independent and idempotent; imports and correction receipts do not backfill random wins',async t=>{
 const f=await fixture(t),now=new Date().toISOString();
 const receipt={id:'L-new',streamer_id:'papa',playerId:'P1',at:now,amount:10,accounting_kind:'receipt',receipt_quantity:10};
 await f.q("insert into papa_v2_entities values('ledger','L-new',$1,'space-001')",[receipt]);
 const event=async(id,data,action='credit')=>f.q("insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,space_id,after_data) values('papa','ledger',$1,$2,'streamer_admin','space-001',$3)",[id,action,data]);
 await event('L-new',receipt);
 const draw=await f.q("select lucky,legend,source_event_id from papa_achievement_request_draws where queue_id='credit:L-new'");
 assert.equal(draw.length,1);await event('L-new',receipt);
 assert.deepEqual(await f.q("select lucky,legend,source_event_id from papa_achievement_request_draws where queue_id='credit:L-new'"),draw);
 await event('L-import',{...receipt,id:'L-import'},'import');
 await event('L-correct',{...receipt,id:'L-correct',correction_of:'L-new'});
 assert.equal((await f.q('select count(*)::int n from papa_achievement_request_draws'))[0].n,1);
});
