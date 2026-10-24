import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createNotificationDevicePreferences} from '../src/notification-device-preferences.js';
import {deriveNotices,queueNoticeCurrent} from '../src/notification-rules.js';

test('device intent survives new instances; blocked permission is never treated as enabled',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 let p=createNotificationDevicePreferences(storage);assert.equal(p.soundEnabled(),true);assert.equal(p.needsSetup('default'),true);
 p.save({setupDone:true,soundEnabled:false,pushAllowed:true});p=createNotificationDevicePreferences(storage);
 assert.equal(p.soundEnabled(),false);assert.equal(p.needsSetup('default'),false);assert.equal(p.canAutoEnable('denied'),false);assert.equal(p.canAutoEnable('default'),false);
 assert.equal(p.canAutoEnable('granted'),true);assert.equal(p.canAutoEnable('granted',{pushEnabled:false}),false);
 p.save({soundEnabled:true,pushAllowed:false});assert.equal(p.soundEnabled(),true);assert.equal(p.canAutoEnable('granted'),false);
});
test('readiness differences notify only the intended player; repeated ready and invalid rows do not replay',()=>{
 const q={id:'q',streamer_id:'room',playerId:'p',title:'Song',status:'waiting',preparationMinutes:5,preparationStartedAt:'a',readyAt:null};
 const state=row=>({streamers:[{id:'room',display_name:'Room'},{id:'other'}],queue:[row],players:[],ledger:[]});
 const ready={...q,preparationMinutes:0,preparationStartedAt:'b',readyAt:'b'};
 const notices=deriveNotices(state(q),state(ready),{streamer_id:'room',role:'admin'});
 assert.equal(notices.length,1);assert.equal(notices[0].recipient,'p');assert.match(notices[0].body,/準備好演唱囉 🎤/);
 assert.equal(deriveNotices(state(ready),state({...ready,readyAt:'c',preparationStartedAt:'c'}),{streamer_id:'room'}).length,0);
 for(const patch of [{archived_at:'x'},{voided_at:'x'},{awaitingAcknowledgment:true}])assert.equal(deriveNotices(state(q),state({...ready,...patch}),{streamer_id:'room'}).length,0);
 assert.equal(deriveNotices(state(q),state(ready),{streamer_id:'other'}).length,0);
});
test('existing minute worker reschedules, cancels and delivers once, with room/player isolation and no public execute',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));
 create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,1);
 create table papa_notifications(streamer_id text,streamer_name text,recipient text,type text,level int,entity_id text,body text);
 insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"a","display_name":"A"},{"id":"b","display_name":"B"}]}');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261024185535_notification_readiness_guards.sql','utf8'));
 const base={status:'waiting',streamer_id:'a',playerId:'player-a',preparationEndsAt:'2020-01-01T00:00:00.000Z',readyAt:null};
 const fixtures={due:base,other:{...base,streamer_id:'b',playerId:'player-b'},rescheduled:{...base,preparationEndsAt:'2099-01-01T00:00:00.000Z'},early:{...base,readyAt:'2020-01-01'},cancelled:{...base,status:'cancelled'},complete:{...base,status:'completed'},void:{...base,voided_at:'x'},archived:{...base,archived_at:'x'},ack:{...base,awaitingAcknowledgment:true},prep:{...base,awaitingPreparation:true}};
 for(const [id,data] of Object.entries(fixtures))await db.query('insert into papa_v2_entities values($1,$2,$3)',['queue',id,data]);
 const run=async()=>(await db.query('select papa_queue_prepare_due() n')).rows[0].n;
 assert.equal(await run(),2);assert.equal(await run(),0);
 const rows=(await db.query('select streamer_id,recipient,entity_id from papa_notifications order by entity_id')).rows;
 assert.deepEqual(rows,[{streamer_id:'a',recipient:'player-a',entity_id:'due'},{streamer_id:'b',recipient:'player-b',entity_id:'other'}]);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(run(),/permission denied/);await db.exec('reset role');}
 assert.equal((await db.query('select count(*)::int n from papa_v2_entities')).rows[0].n,11);
});

test('background retries skip cancelled, rescheduled, stale and cross-tenant readiness notices',()=>{
 const n={type:'ready',entity_id:'q',space_id:'s',streamer_id:'r',recipient:'p',created_at:'2026-10-25T01:00:00Z'};
 const row={space_id:'s',data:{status:'waiting',streamer_id:'r',playerId:'p',readyAt:'2026-10-25T01:00:00Z',preparationStartedAt:'2026-10-25T00:55:00Z'}};
 assert.equal(queueNoticeCurrent(n,row),true);
 for(const patch of [{status:'cancelled'},{status:'completed'},{readyAt:null},{archived_at:'x'},{voided_at:'x'},{streamer_id:'elsewhere'},{playerId:'elsewhere'},{preparationStartedAt:'2026-10-25T01:01:00Z'}])assert.equal(queueNoticeCurrent(n,{...row,data:{...row.data,...patch}}),false);
 assert.equal(queueNoticeCurrent(n,{...row,space_id:'other'}),false);assert.equal(queueNoticeCurrent(n,null),false);
 assert.equal(queueNoticeCurrent({...n,type:'credit'},null),true);
});
