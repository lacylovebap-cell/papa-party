import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {createActivityPage,activityPageHtml} from '../src/activity-view.js';
test('activity is bounded, per-device aggregated, president-only and never touches business Audit',async t=>{
 const db=new PGlite();t.after(()=>db.close());const q=async(s,a=[])=>(await db.query(s,a)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_v2_entities(kind text,id text,data jsonb);insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa","slug":"papa"}]}');
 create table papa_space_streamers(streamer_id text,space_id text);insert into papa_space_streamers values('papa','space-001');
 create function papa_communication_context(s text,r text,a jsonb) returns jsonb language plpgsql stable as $$begin if s<>'space-001' or r<>'papa' or a->>'space_id' is distinct from s then raise exception 'SCOPE_INVALID';end if;return a;end$$;
 create function papa_notice_category_scope(s text,r text,a jsonb,m text) returns jsonb language plpgsql stable as $$begin perform papa_communication_context(s,r,a);return jsonb_build_object('recipient',case a->>'role' when 'super_admin' then '__super__' when 'streamer_admin' then '__admin__' else a->>'player_id' end);end$$;
 create function papa_achievement_player_valid(s text,p text) returns boolean language sql stable as $$select s='space-001' and p='P1'$$;`);
 const before=await q('select kind,id,data from papa_v2_entities');await db.exec(fs.readFileSync('supabase/migrations/202610140003_activity.sql','utf8'));
 const actor={role:'player',space_id:'space-001',player_id:'P1'},president={role:'super_admin',space_id:'space-001'};
 const record=(key,page='book',visible=true,s='space-001')=>q('select papa_activity_record($1,$2,$3,$4,$5,$6)',[s,'papa',actor,key,page,visible]);
 const read=(a=president,page=0)=>q('select papa_activity_page($1,$2,$3,$4) v',['space-001','papa',a,page]);
 await record('a'.repeat(64));await record('b'.repeat(64),'center',false);let r=(await read())[0].v;assert.equal(r.rows.length,1);assert.equal(r.rows[0].online,true);assert.equal(r.rows[0].page,'center');assert.equal(r.pageSize,50);
 const time=(await q("select last_seen from papa_player_activity where actor_key=$1",['a'.repeat(64)]))[0].last_seen;await record('a'.repeat(64));assert.deepEqual((await q('select last_seen from papa_player_activity where actor_key=$1',['a'.repeat(64)]))[0].last_seen,time);
 await assert.rejects(read(actor),/PRESIDENT_REQUIRED/);await assert.rejects(read({role:'streamer_admin',space_id:'space-001'}),/PRESIDENT_REQUIRED/);await assert.rejects(record('c'.repeat(64),'book',true,'foreign'),/SCOPE_INVALID|SCOPE_INVALID/);await assert.rejects(record('c'.repeat(64),'private message body'),/INPUT_INVALID/);
 await q("update papa_player_activity set last_seen=now()-interval '4 minutes'");assert.equal((await read())[0].v.rows[0].online,false);await q("update papa_player_activity set last_seen=now()-interval '25 hours'");assert.equal((await read())[0].v.total,0);
 assert.deepEqual(await q('select kind,id,data from papa_v2_entities'),before);
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(q('select * from papa_player_activity'),/permission denied/);if(role!=='service_role')await assert.rejects(read(),/permission denied/);await db.exec('reset role');}
});
test('activity demand reads coalesce, paginate and reject stale identity; names are escaped and jump input is present',async()=>{
 let c={active:true,key:'president:space-001',spaceId:'space-001'},resolve;const calls=[],render=[];
 const page=createActivityPage({context:()=>c,render:x=>render.push(x),api:b=>{calls.push(b);return new Promise(r=>resolve=r);}});
 const p=page.load();page.load();assert.equal(calls.length,1);resolve({version:1,spaceId:'space-001',page:0,pageSize:50,total:51,rows:[]});await p;await page.load();assert.equal(calls.length,1);
 const p2=page.next();assert.equal(calls.at(-1).page,1);c={...c,key:'new-login'};resolve({version:1,spaceId:'space-001',page:1,pageSize:50,total:51,rows:[]});await p2;assert.equal(render.at(-1).loading,true);
 const html=activityPageHtml({page:0,total:51,rows:[{player_id:'P1',streamer_id:'papa',page:'book',last_seen:'2026-10-14T10:00:00Z',online:true}]},{playerName:()=>'<script>',roomName:()=>'<Room>'});
 assert.doesNotMatch(html,/<script>/);assert.match(html,/activity-page/);assert.match(html,/跳頁/);assert.match(html,/max="2"/);
});
test('video bucket migration leaves existing photo limits intact, is repeatable and rejects incompatible existing destination',async t=>{
 const db=new PGlite();t.after(()=>db.close());const sql=fs.readFileSync('supabase/migrations/202610140002_card_video_bucket.sql','utf8');
 await db.exec("create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);insert into storage.buckets values('papa-photos','papa-photos',true,3145728,array['image/webp']);");
 const photo=(await db.query("select * from storage.buckets where id='papa-photos'")).rows;await db.exec(sql);await db.exec(sql);assert.deepEqual((await db.query("select * from storage.buckets where id='papa-photos'")).rows,photo);
 assert.equal((await db.query("select file_size_limit from storage.buckets where id='papa-card-media'")).rows[0].file_size_limit,20971520);
 await db.exec("update storage.buckets set public=false where id='papa-card-media'");await assert.rejects(db.exec(sql),/CONFIGURATION_INVALID/);await db.exec('rollback');assert.equal((await db.query("select public from storage.buckets where id='papa-card-media'")).rows[0].public,false);
});
