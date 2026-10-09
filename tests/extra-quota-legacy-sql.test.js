import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';

const migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const quotaMigration='202610090004_player_extra_quota.sql';
const at='2026-10-09T12:00:00.000Z',tokens={president:'1'.repeat(64),legacyPresident:'2'.repeat(64),streamer:'3'.repeat(64),
 other:'4'.repeat(64),player:'5'.repeat(64),expired:'6'.repeat(64),forged:'7'.repeat(64),wrongRole:'8'.repeat(64)};

async function fixture(t){
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args=[])=>(await q('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result;
 await db.exec('create role anon;create role authenticated;create role service_role;create table party_state(id int primary key,data jsonb);insert into party_state values(1,\'{"retained":"original V1 private backup"}\');');
 const base=migration('202609170001_party_v2.sql');await db.exec(base.slice(0,base.indexOf('insert into storage.buckets')));
 for(const name of ['202609240001_release_a.sql','202609240003_notifications.sql','202609250001_roles_and_notification_scope.sql'])await db.exec(migration(name));
 await q("insert into papa_v2_entities(kind,id,data) values('meta','1',$1),('settings','1',$2)",[{schemaVersion:3,streamers:[
  {id:'papa',slug:'papa-home',display_name:'Papa Room',active:true},{id:'michelle',slug:'michelle-home',display_name:'Michelle Room',active:true},
  {id:'dormant',slug:'dormant-home',display_name:'Dormant Room',active:false}],streamerSettings:{papa:{hourlyLimit:2},michelle:{hourlyLimit:3},dormant:{}}},
  {hourlyLimit:2,futurePrivate:{keep:'original settings'}}]);
 for(let i=1;i<=7;i++)await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",['P'+i,{playerId:'P'+i,name:'Player '+i,
  ids:['platform-'+i],names:['Former '+i],password:'retained-player-password-'+i,note:'retained-private-note',privateHistory:['original-private-history']}]);
 for(const [id,room] of [['S1','papa'],['S2','michelle']])await q("insert into papa_v2_entities(kind,id,data) values('songs',$1,$2)",[id,{songId:id,streamer_id:room,title:'Song '+id,
  artist:'Artist',lyrics:'original lyric body '.repeat(2000),privateNotes:'original song note',lyricHistory:['original lyric history'],creditCost:1,tags:['retained']}]);
 const queue=async(id,playerId,status='waiting',extra={},room='papa')=>q("insert into papa_v2_entities(kind,id,data) values('queue',$1,$2)",[id,
  {id,streamer_id:room,playerId,songId:room==='papa'?'S1':'S2',title:'Saved snapshot',artist:'Saved artist',kind:'saved',status,creditCost:1,at,acceptedAt:at,note:'retained history note',...extra}]);
 await queue('Q2','P2');await queue('Q2-repeat','P2');await queue('Q3','P3','completed',{completedAt:at,history_effective_at:at,quota_effective_at:at});
 await queue('Q4-test','P4','waiting',{test:true});await queue('Q5-self','P5','waiting',{selfProvided:true});await queue('Q6-live','P6','waiting',{kind:'live'});
 await queue('Q7-cancelled','P7','cancelled');await queue('Q7-pending','P7','pending');await queue('Q4-foreign','P4','waiting',{},'michelle');
 for(const [kind,id,data] of [['ledger','L1',{id:'L1',streamer_id:'papa',playerId:'P1',amount:10,note:'retained credit',at}],
  ['crowns','C1',{id:'C1',streamer_id:'papa',playerId:'P1',songId:'S1',ownerName:'Original crown owner'}],
  ['cards','A1',{id:'A1',streamer_id:'papa',playerId:'P1',startsAt:at,note:'retained card'}],
  ['wishes','W1',{id:'W1',streamer_id:'papa',playerId:'P1',title:'Retained wish'}]])await q('insert into papa_v2_entities(kind,id,data) values($1,$2,$3)',[kind,id,data]);
 for(const file of fs.readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(f=>/^2026100100\d\d_/.test(f)||/^20261005000[123]_/.test(f)).sort())await db.exec(migration(file));
 for(const [hash,id,role,room,expired] of [[tokens.president,'__admin__','super_admin',null,false],[tokens.legacyPresident,'__admin__',null,null,false],
  [tokens.streamer,'__streamer__:papa','streamer_admin','papa',false],[tokens.other,'__streamer__:michelle','streamer_admin','michelle',false],
  [tokens.player,'P1','player',null,false],[tokens.expired,'__admin__','super_admin',null,true],[tokens.forged,'P1','streamer_admin','papa',false],
  [tokens.wrongRole,'__admin__','player',null,false]])await q("insert into papa_v2_sessions(token_hash,player_id,login_id,role,streamer_id,expires_at) values($1,$2,'retained login',$3,$4,now()+case when $5 then interval '-1 day' else interval '1 day' end)",[hash,id,role,room,expired]);
 await q("insert into papa_streamer_accounts(streamer_id,password_hash,enabled) values('papa','retained-manager-password-hash',true),('michelle','retained-other-manager-password-hash',true)");
 const revision=async()=>Number((await q('select revision from papa_v2_revision where id=1'))[0].revision);
 const source=async()=>({v1:await q('select id,data from party_state order by id'),entities:await q('select kind,id,data from papa_v2_entities order by kind,id'),
  sessions:await q('select token_hash,player_id,login_id,role,streamer_id,expires_at from papa_v2_sessions order by token_hash'),
  managers:await q('select streamer_id,password_hash,enabled,updated_at from papa_streamer_accounts order by streamer_id'),
  notices:await q('select id,streamer_id,recipient,body from papa_notifications order by id'),push:await q('select id,status from papa_push_jobs order by id')});
 const events=()=>q('select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,before_data,after_data from papa_events order by id');
 const quotas=()=>q('select streamer_id,player_id,space_id,extra_quota,enabled,updated_at,updated_by from papa_player_extra_quotas order by streamer_id,player_id');
 const originalFull=await rpc('papa_v2_snapshot'),originalLean=await rpc('papa_v2_read_snapshot'),before={source:await source(),events:await events(),revision:await revision()};
 await db.exec(migration(quotaMigration));assert.deepEqual({source:await source(),events:await events(),revision:await revision()},before,'additive migration preserves formal source/auth/audit data');
 assert.equal((await q("select to_regclass('public.papa_accounts') relation"))[0].relation,null,'fixture and migration require no unpublished Account foundation');
 const manage=async(extra=3,enabled=true,room='papa',player='P1',session=tokens.streamer,expected)=>rpc('papa_manage_player_extra_quota',[expected??await revision(),room,player,extra,enabled,session]);
 const snap=async(lean=true,room='papa',player=null)=>rpc('papa_v2_quota_snapshot',[lean,room,player]);
 const seed=async(room,player,extra,enabled=true)=>q('insert into papa_player_extra_quotas(streamer_id,player_id,extra_quota,enabled,updated_by) values($1,$2,$3,$4,\'fixture-manager\')',[room,player,extra,enabled]);
 return {db,q,rpc,revision,source,events,quotas,manage,snap,seed,originalFull,originalLean};
}

test('legacy quota saves atomically change one normalized right, one named audit and one original revision without altering formal data',async t=>{
 const {q,manage,source,events,quotas,revision,snap,originalFull}=await fixture(t),before=await source(),initial=await revision(),oldEvents=await events();
 assert.deepEqual((await q("select snapshot from papa_release_backups where release='10.09-QUOTA-before'"))[0].snapshot,originalFull);
 assert.equal(Number(await manage()),initial+1);const first=(await quotas())[0];
 assert.equal(first.space_id,'space-001');assert.equal(first.streamer_id,'papa');assert.equal(first.player_id,'P1');assert.equal(first.extra_quota,3);assert.equal(first.enabled,true);
 assert.equal(first.updated_by,'__streamer__:papa');assert.ok(first.updated_at);
 const audit=(await events()).at(-1);assert.equal((await events()).length,oldEvents.length+1);
 assert.equal(audit.action,'extraQuota');assert.equal(audit.entity_kind,'extra_quota');assert.equal(audit.entity_id,'P1');assert.equal(audit.actor_role,'streamer_admin');
 assert.deepEqual(audit.after_data,{streamer_id:'papa',streamer_name:'Papa Room',playerId:'P1',playerName:'Player 1',extra_quota:3,enabled:true});assert.equal(audit.before_data,null);
 assert.doesNotMatch(JSON.stringify(audit),/password|session_hash|token_hash|private|history|login/);
 const unchanged={quotas:await quotas(),events:await events(),revision:await revision()};
 assert.equal(Number(await manage()),initial+1);assert.deepEqual({quotas:await quotas(),events:await events(),revision:await revision()},unchanged);
 assert.equal(Number(await manage(5,false)),initial+2);assert.equal((await events()).at(-1).before_data.extra_quota,3);assert.equal((await quotas())[0].enabled,false);
 assert.equal(Number(await manage(0,true)),initial+3);assert.equal((await quotas())[0].enabled,false);assert.equal((await snap(true,'papa','P1')).revision,initial+3);
 assert.deepEqual(await source(),before,'credits, quota settings, passwords, song private bodies, historical rows, crown/card/wish, sessions and notices are retained');
});

test('single snapshot scopes caps to selected room saved participants plus target, exposes only target rights, and preserves lean/full row behavior',async t=>{
 const {rpc,snap,seed,source,originalFull,originalLean,quotas}=await fixture(t);
 for(let i=1;i<=7;i++)await seed('papa','P'+i,i);
 await seed('michelle','P1',9);await seed('michelle','P2',8);await seed('dormant','P1',7);await seed('michelle','P3',0,false);
 const before=await source(),guest=await snap(),selected=await snap(true,'papa-home','P1'),manager=await snap(false,'papa','P4');
 assert.deepEqual(guest.rows,originalLean.rows);assert.deepEqual(selected.rows,originalLean.rows);assert.deepEqual(manager.rows,originalFull.rows);
 assert.deepEqual(guest.extraQuotas.map(r=>r.player_id),['P2','P3','P4','P5','P7']);assert.deepEqual(guest.extraQuotaRights,{});
 assert.deepEqual(selected.extraQuotas.map(r=>r.player_id),['P1','P2','P3','P4','P5','P7']);assert.ok(selected.extraQuotas.every(r=>r.streamer_id==='papa'));
 assert.deepEqual(selected.extraQuotaRights,{P1:[{streamer_id:'michelle',streamer_name:'Michelle Room',extra_quota:9},{streamer_id:'papa',streamer_name:'Papa Room',extra_quota:1}]});
 assert.deepEqual(manager.extraQuotas.map(r=>r.player_id),['P2','P3','P4','P5','P7']);assert.deepEqual(Object.keys(manager.extraQuotaRights),['P4']);
 const other=await snap(true,'michelle-home','P1');assert.deepEqual(other.extraQuotas.map(r=>r.player_id),['P1']);assert.ok(other.extraQuotas.every(r=>r.streamer_id==='michelle'));
 assert.equal(JSON.stringify(selected.rows.filter(r=>r.kind==='songs')).includes('original lyric body'),false);
 assert.equal(JSON.stringify(manager.rows.filter(r=>r.kind==='songs')).includes('original lyric body'),true);
 assert.deepEqual(await rpc('papa_v2_read_snapshot'),originalLean,'old lean API contract remains unchanged');
 const backup=await rpc('papa_v2_snapshot');assert.deepEqual(backup.rows,originalFull.rows);assert.equal(backup.extraQuotas.length,(await quotas()).length);
 assert.ok(backup.extraQuotas.some(r=>r.streamer_id==='dormant'));assert.ok(backup.extraQuotas.some(r=>!r.enabled));assert.ok(backup.extraQuotas.every(r=>r.updated_at&&r.updated_by));
 assert.deepEqual(await source(),before);
});

test('stored unexpired legacy manager sessions, exact room/player scope, stale revision, bounds and browser grants are enforced',async t=>{
 const {db,q,rpc,manage,snap,source,events,quotas,revision}=await fixture(t),initial=await revision(),before={source:await source(),events:await events(),quotas:await quotas(),revision:initial};
 for(const session of [null,'bad','a'.repeat(64),tokens.player,tokens.expired,tokens.forged,tokens.wrongRole,tokens.other])await assert.rejects(manage(3,true,'papa','P1',session),/EXTRA_QUOTA_ACTOR_INVALID/);
 await q("update papa_streamer_accounts set enabled=false where streamer_id='papa'");await assert.rejects(manage(),/EXTRA_QUOTA_ACTOR_INVALID/);
 await q("update papa_streamer_accounts set enabled=true where streamer_id='papa'");
 for(const [room,player,session,error] of [['missing','P1',tokens.president,/EXTRA_QUOTA_ROOM_INVALID/],
  ['papa-home','P1',tokens.president,/EXTRA_QUOTA_ROOM_INVALID/],['papa','missing',tokens.president,/EXTRA_QUOTA_PLAYER_INVALID/]])await assert.rejects(manage(3,true,room,player,session),error);
 await assert.rejects(manage(3,true,'papa','P1',tokens.president,initial+1),/VERSION_CONFLICT/);
 for(const args of [[initial,'papa','P1',-1,true,tokens.president],[initial,'papa','P1',100001,true,tokens.president],
  [initial,'papa','P1',null,true,tokens.president],[initial,'papa','P1',1,null,tokens.president],[null,'papa','P1',1,true,tokens.president],
  [-1,'papa','P1',1,true,tokens.president],[initial,'','P1',1,true,tokens.president],[initial,'papa','x'.repeat(201),1,true,tokens.president]])
  await assert.rejects(rpc('papa_manage_player_extra_quota',args),/EXTRA_QUOTA_INVALID/);
 await assert.rejects(snap(true,'missing','P1'),/EXTRA_QUOTA_ROOM_INVALID/);assert.deepEqual((await snap(true,'dormant')).extraQuotas,[]);
 await assert.rejects(snap(true,'papa','missing'),/EXTRA_QUOTA_PLAYER_INVALID/);await assert.rejects(snap(true,'papa',''),/EXTRA_QUOTA_INVALID/);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);try{
   await assert.rejects(manage(3,true,'papa','P1',tokens.president,initial),/permission denied/);await assert.rejects(snap(),/permission denied/);
   await assert.rejects(q('select player_id from papa_player_extra_quotas'),/permission denied/);await assert.rejects(rpc('papa_v2_snapshot_before_extra_quota'),/permission denied/);
  }finally{await db.exec('reset role');}
 }
 assert.deepEqual({source:await source(),events:await events(),quotas:await quotas(),revision:await revision()},before);
 await db.exec('set role service_role');try{
  await assert.rejects(rpc('papa_v2_snapshot_before_extra_quota'),/permission denied/);
  assert.equal(Number(await manage(4,true,'michelle','P1',tokens.legacyPresident,initial)),initial+1);assert.equal((await snap(true,'michelle','P1')).extraQuotas[0].extra_quota,4);
 }finally{await db.exec('reset role');}
 assert.equal((await events()).at(-1).actor_role,'super_admin');
});

test('audit failure rolls back quota inserts/updates and revision; reads do not mutate or fan out notices',async t=>{
 const {db,manage,source,events,quotas,revision,snap}=await fixture(t);await manage();
 const before={source:await source(),events:await events(),quotas:await quotas(),revision:await revision()};
 await db.exec("create function fixture_reject_quota_audit() returns trigger language plpgsql as $$begin if new.action='extraQuota' then if new.after_data->>'playerName' is null or new.after_data ? 'session_hash' then raise exception 'FIXTURE_UNSAFE_QUOTA_AUDIT';end if;raise exception 'FIXTURE_QUOTA_AUDIT_FAILED';end if;return new;end$$;create trigger zz_fixture_reject_quota_audit before insert on papa_events for each row execute function fixture_reject_quota_audit();");
 await assert.rejects(manage(8),/FIXTURE_QUOTA_AUDIT_FAILED/);await assert.rejects(manage(4,true,'papa','P2'),/FIXTURE_QUOTA_AUDIT_FAILED/);
 assert.deepEqual({source:await source(),events:await events(),quotas:await quotas(),revision:await revision()},before);
 await snap(true,'papa','P1');await snap(false,'papa','P2');assert.deepEqual({source:await source(),events:await events(),quotas:await quotas(),revision:await revision()},before);
});

test('quota and original entity/history commits share the same revision and reject stale concurrent saves',async t=>{
 const {q,rpc,manage,revision,source,events,quotas}=await fixture(t),initial=await revision(),before=await source();
 const results=await Promise.allSettled([manage(3,true,'papa','P1',tokens.president,initial),manage(5,true,'papa','P2',tokens.president,initial)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/VERSION_CONFLICT/);
 assert.equal(await revision(),initial+1);assert.equal((await quotas()).length,1);
 const history=(await q("select data from papa_v2_entities where kind='queue' and id='Q3'"))[0].data;
 const changed={...history,history_effective_at:'2026-10-08T12:00:00.000Z',quota_effective_at:'2026-10-08T12:00:00.000Z',original_times:{completedAt:history.completedAt}};
 const commit=expected=>rpc('papa_release_b_commit',[expected,[{kind:'queue',id:'Q3',data:changed}],[],{role:'super_admin',streamer_id:'papa',action:'recordTime'},[]]);
 const afterQuota={source:await source(),events:await events(),quotas:await quotas(),revision:await revision()};
 await assert.rejects(commit(initial),/VERSION_CONFLICT/);assert.deepEqual({source:await source(),events:await events(),quotas:await quotas(),revision:await revision()},afterQuota);
 assert.equal(Number(await commit(initial+1)),initial+2);assert.deepEqual(await quotas(),afterQuota.quotas);
 const final=await source();assert.deepEqual(final.entities.filter(r=>r.kind!=='queue'||r.id!=='Q3'),before.entities.filter(r=>r.kind!=='queue'||r.id!=='Q3'));
 for(const key of ['v1','sessions','managers','notices','push'])assert.deepEqual(final[key],before[key]);
 assert.deepEqual((await q("select data from papa_v2_entities where kind='queue' and id='Q3'"))[0].data,changed);
});
