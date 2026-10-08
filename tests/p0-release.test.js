import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {empty,mutate,scopeState,balance,reservedHour,usedHour,queuePrepared,queuePreparation,publicView} from '../src/core.js';
import {deriveNotices} from '../src/notification-rules.js';
import {eventDescription,catalogGroupKey} from '../src/catalog-tools.js';
const admin={role:'admin'},now='2026-10-05T00:00:00Z';
function fixture(){let s=mutate(empty(),{type:'player',data:{name:'玩家',balance:4}},admin,now);s=mutate(s,{type:'song',data:{title:'兩首歌',artist:'原歌手',creditCost:2}},admin,now);const p={role:'player',playerId:s.players[0].playerId};return {s,p,song:s.songs[0].songId};}
test('new saved requests reserve cost, require acknowledgment, and zero prep notifies without debit',()=>{
 const f=fixture(),request=mutate(f.s,{type:'request',data:{songId:f.song,kind:'saved'}},f.p,now),q=request.queue[0];
 assert.equal(q.awaitingAcknowledgment,true);assert.match(queuePreparation(q,now),/等待主播回應/);assert.equal(reservedHour(request,now),2);assert.equal(balance(request,f.p.playerId),4);assert.equal(publicView(request,null,now).nowPlaying,null);
 assert.throws(()=>mutate(request,{type:'queue',data:{id:q.id,operation:'complete'}},admin,now),/確認收到/);
 for(const value of [-1,121,0.5])assert.throws(()=>mutate(request,{type:'queue',data:{id:q.id,operation:'acknowledge',preparationMinutes:value}},admin,now),/準備/);
 const confirmed=mutate(request,{type:'queue',data:{id:q.id,operation:'acknowledge',preparationMinutes:0}},admin,now);assert.ok(queuePrepared(confirmed.queue[0]));assert.equal(reservedHour(confirmed,now),2);assert.equal(balance(confirmed,f.p.playerId),4);
 const notices=deriveNotices(request,confirmed,{streamer_id:'papa',role:'admin'},now);assert.equal(notices.filter(n=>n.type==='ready').length,1);assert.equal(notices[0].recipient,f.p.playerId);
 assert.throws(()=>mutate(confirmed,{type:'queue',data:{id:q.id,operation:'acknowledge',preparationMinutes:0}},admin,now),/已確認/);
 const completed=mutate(confirmed,{type:'queue',data:{id:q.id,operation:'complete'}},admin,now);assert.equal(balance(completed,f.p.playerId),2);assert.equal(usedHour(completed,now),2);assert.equal(reservedHour(completed,now),0);
});
test('gift acknowledgment and timed preparation preserve cancellation and legacy queues',()=>{
 const f=fixture(),s=mutate(f.s,{type:'request',data:{songId:f.song,kind:'live',giftConfirmed:true}},f.p,now),q=s.queue[0];
 const c=mutate(s,{type:'queue',data:{id:q.id,operation:'approve',preparationMinutes:120}},admin,now);assert.equal(c.queue[0].preparationEndsAt,'2026-10-05T02:00:00.000Z');assert.match(queuePreparation(c.queue[0],'2026-10-05T01:59:00Z'),/1 分鐘/);assert.equal(queuePreparation(c.queue[0],'2026-10-05T02:00:00Z'),'已準備好');
 assert.equal(balance(c,f.p.playerId),4);assert.equal(reservedHour(c,now),0);const cancelled=mutate(c,{type:'cancelOwn',data:{id:q.id}},f.p,now);assert.equal(cancelled.queue[0].status,'cancelled');assert.equal(balance(cancelled,f.p.playerId),4);
 assert.ok(queuePrepared({status:'waiting'}));const old=structuredClone(c);delete old.queue[0].awaitingAcknowledgment;delete old.queue[0].awaitingPreparation;assert.ok(queuePrepared(old.queue[0]));
});
test('single review and grouped duplicate review render as independent tabs',()=>{
 const src=fs.readFileSync('src/app.js','utf8'),render=src.slice(src.indexOf('function catalogReviewHtml()'),src.indexOf('\nasync function scanCatalogCandidates()'));
 const values={items:[{id:'one',title:'單筆',artist:'甲'}],section:'singles',selected:new Set(),selectedRows:new Map(),total:1};
 const ctx=vm.createContext({isSuperAdmin:()=>true,catalogView:values,state:{streamers:[]},catalogGroupKey,eventDescription,h:String,playerName:()=>'',song:()=>null,time:String,blank:()=>'',button:(label,act)=>`<button data-act="${act}">${label}</button>`,catalogPager:()=>''});vm.runInContext(render,ctx);const html=vm.runInContext('catalogReviewHtml()',ctx);assert.match(html,/人工指定同一首/);assert.match(html,/catalog-single-candidate/);assert.doesNotMatch(html,/catalogGroupDecision/);values.section='duplicates';values.groups=[{id:'g',total:2,rows:[{id:'a',title:'Honey'},{id:'b',title:'Honey'}]}];const grouped=vm.runInContext('catalogReviewHtml()',ctx);assert.equal((grouped.match(/catalogGroupDecision/g)||[]).length,3);assert.doesNotMatch(grouped,/catalog-single-candidate/);
});
test('indexed event reads, snapshots and due notices are bounded, isolated and idempotent in PostgreSQL',async t=>{
 const db=new PGlite({extensions:{pg_trgm}});t.after(()=>db.close());const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,1);
 create table papa_notice_config(id text primary key,value jsonb);
 create function papa_v2_snapshot() returns jsonb language sql as $$select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(e)) from papa_v2_entities e))$$;`);
 await db.exec(fs.readFileSync('supabase/migrations/202609240001_release_a.sql','utf8'));
 await db.exec(`create table papa_notifications(id uuid default gen_random_uuid(),streamer_id text,streamer_name text,recipient text,type text,level int,entity_id text,body text);`);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>/^2026100100\d\d_/.test(f)).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610050001_catalog_usability.sql','utf8'));
 const original={title:'正式歌',artist:'歌手',songId:'s',streamer_id:'papa',lyrics:'不可外洩'};await q('insert into papa_v2_entities values($1,$2,$3)',['songs','s',original]);
 await db.exec(fs.readFileSync('supabase/migrations/202610050002_p0_queue_audit.sql','utf8'));assert.deepEqual((await q("select data from papa_v2_entities where kind='songs'"))[0].data,original);
 await q('insert into papa_v2_entities values($1,$2,$3)',['meta','1',{streamers:[{id:'papa',display_name:'怕怕'}]}]);
 const due={id:'q',streamer_id:'papa',playerId:'p',songId:'s',title:'正式歌',artist:'歌手',status:'waiting',preparationEndsAt:'2020-01-01T00:00:00.000Z',readyAt:null};
 await q('insert into papa_v2_entities values($1,$2,$3)',['queue','q',due]);await q('insert into papa_v2_entities values($1,$2,$3)',['queue','cancel',{...due,id:'cancel',status:'cancelled'}]);
 assert.equal((await q('select papa_queue_prepare_due() n'))[0].n,1);assert.equal((await q('select papa_queue_prepare_due() n'))[0].n,0);assert.equal((await q('select count(*)::int n from papa_notifications'))[0].n,1);
 const rows=(await q("select papa_event_page_v2('papa',0,true,null,2,0) r"))[0].r;assert.equal(rows.rows.length,2);assert.ok(rows.hasMore);assert.ok(!JSON.stringify(rows).includes('不可外洩'));
 const event=(await q("select after_data from papa_events where entity_kind='queue' and entity_id='q' order by id desc limit 1"))[0];assert.deepEqual(event.after_data.songSnapshot,{title:'正式歌',artist:'歌手'});
 assert.equal((await q("select papa_event_page_v2('other',0,false) r"))[0].r.rows.length,0);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(q("select papa_queue_prepare_due()"),/permission denied/);await assert.rejects(q("select papa_event_page_v2('papa')"),/permission denied/);await db.exec('reset role');}
 assert.ok((await q("select indexname from pg_indexes where indexname='papa_events_global_feed'")).length);
});
test('general operation history distinguishes rows, empty state, malformed response and actual failure',async()=>{
 const src=fs.readFileSync('src/app.js','utf8'),fn=src.slice(src.indexOf('async function loadEvents()'),src.indexOf('\nfunction allocateDialog('));
 for(const value of [{rows:[{id:1}],hasMore:false},{rows:[],hasMore:false},{bad:true},new Error('伺服器讀取逾時')]){
  const holder={innerHTML:'',textContent:''};const ctx=vm.createContext({$:()=>holder,demo:false,draft:null,eventPage:0,api:async()=>{if(value instanceof Error)throw value;return value;},blank:x=>x,eventHtml:x=>'歷史 '+x.id,button:()=>''});vm.runInContext(fn,ctx);await vm.runInContext('loadEvents()',ctx);
  if(value.rows?.length)assert.match(holder.innerHTML,/歷史 1/);else if(value.rows)assert.match(holder.innerHTML,/尚無新操作紀錄/);else assert.match(holder.textContent,value instanceof Error?/伺服器讀取逾時/:/回傳格式不正確/);
 }
});
