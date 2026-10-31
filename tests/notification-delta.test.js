import {createNoticeDelta} from '../src/notification-delta.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('incremental notices preserve tied timestamps, bound pages and enforce room/recipient scope',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_notifications(id uuid primary key,streamer_id text,streamer_name text,recipient text,type text,level int,body text,entity_id text,created_at timestamptz,read_at timestamptz,space_id text);
 insert into papa_notifications select lpad(to_hex(i),32,'0')::uuid,'a','A','p','message',2,'test',null,'2026-10-31'::timestamptz,null,'space-a' from generate_series(1,120)i;
 insert into papa_notifications values('ffffffff-ffff-ffff-ffff-ffffffffffff','b','B','p','message',2,'private',null,'2026-10-31',null,'space-b');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261031002615_notification_incremental_sync.sql','utf8'));
 const call=async(room,owner,time,id)=>(await db.query('select papa_notice_delta($1,$2,$3,$4) rows',[room,owner,time,id])).rows[0].rows;
 let id='00000000-0000-0000-0000-000000000000',seen=[];
 for(let page=0;page<3;page++){const rows=await call('a','p','2026-10-31',id);assert.ok(rows.length<=51);seen.push(...rows.map(n=>n.id));id=rows.at(-1).id;}
 assert.equal(seen.length,120);assert.equal(new Set(seen).size,120);
 assert.deepEqual(await call('a','other','2026-10-30',id),[]);
 assert.deepEqual(await call('__global__','p','2026-10-30',id),[]);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(call('a','p','2026-10-30',id),/permission denied/);await db.exec('reset role');}
 assert.equal((await db.query('select count(*)::int n from papa_notifications')).rows[0].n,121);
});

test('client drains only bounded incremental pages, rejects stale identity and resets its cursor',async()=>{
 const d=createNoticeDelta();let calls=0;
 d.seed([{id:'000',created_at:'2026-10-31T00:00:00Z'}]);
 const api=async()=>{calls++;return Array.from({length:51},(_,i)=>({id:String(calls*100+i),created_at:'2026-10-31T00:00:00Z'}));};
 const r=await d.read(api,()=>true);assert.equal(r.rows.length,204);assert.equal(r.more,true);assert.equal(calls,4);
 const stale=await d.read(api,()=>false);assert.equal(stale.rows.length,0);
 d.reset();await d.read(api,()=>true);assert.equal(calls,5,'reset does not query old scope');
});

 test('failed later page retries all undelivered notices without losing earlier pages',async()=>{
 const d=createNoticeDelta();d.seed([{id:'000',created_at:'2026-10-31T00:00:00Z'}]);
 const page=Array.from({length:51},(_,i)=>({id:String(100+i),created_at:'2026-10-31T00:00:00Z'}));
 let calls=0;
 await assert.rejects(d.read(async()=>{if(++calls===2)throw Error('network');return page;},()=>true),/network/);
 const args=[];const result=await d.read(async a=>{args.push(a);return args.length===1?page:[];},()=>true);
 assert.equal(args[0].afterId,'000');assert.equal(result.rows.length,51);
 });

test('cursor compares time zones and retains PostgreSQL microseconds',async()=>{
 const d=createNoticeDelta();d.seed([{id:'999',created_at:'2026-10-31T08:00:00.000001+08:00'}]);
 const row={id:'001',created_at:'2026-10-31T00:00:00.000002Z'};
 assert.deepEqual((await d.read(async()=>[row],()=>true)).rows,[row]);
});
test('reset during a pending page cannot overwrite the new identity cursor',async()=>{
 const d=createNoticeDelta();d.seed([{id:'100',created_at:'2026-10-31T00:00:00Z'}]);
 let resolve;const pending=d.read(()=>new Promise(r=>resolve=r),()=>true);
 d.reset();d.seed([{id:'200',created_at:'2026-10-31T00:00:00Z'}]);
 resolve([{id:'300',created_at:'2026-10-31T00:00:00Z'}]);
 assert.deepEqual((await pending).rows,[]);
 await d.read(async args=>{assert.equal(args.afterId,'200');return [];},()=>true);
});
