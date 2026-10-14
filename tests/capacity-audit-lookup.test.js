import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('Audit snapshot JSON stays identical while self-contained events skip song lookup',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec(`create role anon;create role authenticated;
 create table lookup_calls(n int);insert into lookup_calls values(0);
 create function observed_song(value jsonb) returns jsonb language plpgsql volatile as $$begin update lookup_calls set n=n+1;return value;end$$;
 create table song_source(kind text,id text,data jsonb);
 insert into song_source values('songs','s1','{"title":"Current name","artist":"Current artist"}');
 create view papa_v2_entities as select kind,id,observed_song(data) data from song_source;
 create table papa_catalog_variants(id uuid,title text,artist text);
 create function papa_audit_redact(value jsonb) returns jsonb language sql immutable as $$select value$$;
 create table papa_events(entity_kind text,before_data jsonb,after_data jsonb);`);
 const old=fs.readFileSync('supabase/migrations/202610050002_p0_queue_audit.sql','utf8');
 const original=old.slice(old.indexOf('create function public.papa_event_song_snapshot()'),old.indexOf('-- Scheduled readiness'));
 await db.exec(original);
 const fixtures=[
  ['songs',null,{songId:'s1',title:'Historic name',artist:'Historic artist',lyrics:'Preserved'}],
  ['songs',{songId:'s1',title:'Deleted name',artist:'Deleted artist'},null],
  ['queue',null,{songId:'s1',title:'Requested title',status:'completed'}],
  ['wishes',null,{songId:'s1'}],
  ['request',null,{song_id:'s1',title:null,artist:null}],
  ['ledger',null,{amount:3}],
  ['queue',null,{songId:'missing'}],
 ];
 for(const f of fixtures)await q('insert into papa_events values($1,$2,$3)',f);
 const before=await q('select * from papa_events');const oldCalls=(await q('select n from lookup_calls'))[0].n;
 // Reset only isolated synthetic fixture, never any remote connection.
 await db.exec('truncate papa_events;update lookup_calls set n=0;');
 await db.exec(fs.readFileSync('supabase/migrations/202610140010_capacity_audit_lookup.sql','utf8'));
 for(const f of fixtures)await q('insert into papa_events values($1,$2,$3)',f);
 assert.deepEqual(await q('select * from papa_events'),before);
 assert.equal((await q('select n from lookup_calls'))[0].n,oldCalls-2);
 await db.exec(fs.readFileSync('ops/capacity-audit-rollback-20261014.sql','utf8'));
 assert.deepEqual(await q('select * from papa_events'),before,'schema rollback retains complete event rows');
});
