import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture} from './platform-membership-fixture.js';
import {createPlatformManagement} from '../src/platform-management.js';

test('space cards use stable IDs, bound nested hosts, preserve empty tenants and deny other roles',async t=>{
 const {db,q,president,other}=await fixture(t);
 await db.exec("create table papa_public_route_spaces(space_id text primary key,layout text,code text);create table papa_public_route_streamers(space_id text,streamer_id text,code text);create function papa_public_route_home(text,text,text) returns text language sql as $$select '/'||$3$$;insert into papa_public_route_spaces values('space-001','flat','sm');insert into papa_spaces(id,slug,display_name,status,tenant_kind) values('ind','ind','Room A','suspended','independent');");
 for(let i=0;i<24;i++)await q("insert into papa_space_streamers(space_id,streamer_id) values('space-001',$1)",['host-'+i]);
 await q("update papa_v2_entities set data=jsonb_build_object('streamers',$1::jsonb) where kind='meta'",[JSON.stringify([{id:'room-a',display_name:'Room A'},...Array.from({length:24},(_,i)=>({id:'host-'+i,display_name:'Host '+i}))])]);
 await db.exec(fs.readFileSync('supabase/migrations/20261025213142_platform_space_center_directory.sql','utf8'));
 const read=async(kind='all',space=null,page=1,actor=president)=>(await q("select papa_space_center_directory($1,$2,'',$3,$4) value",[actor,kind,page,space]))[0].value;
 const all=await read();assert.equal(all.total,2);assert.equal(all.summary.halls,1);assert.equal(all.summary.streamerSpaces,25);assert.equal(all.summary.pendingSetup,1);
 const hall=all.rows.find(r=>r.id==='space-001');assert.equal(hall.kind,'hall');assert.equal(hall.hostCount,25);assert.equal(hall.hosts.length,12);
 assert.equal((await read('independent')).rows[0].id,'ind');assert.equal((await read('all','space-001',2)).rows.length,5);
 assert.equal((await q("select tenant_kind from papa_spaces where id='space-001'"))[0].tenant_kind,null);
 // Shared identities appear once despite multiple roles, and previews stay
 // bounded even when a Space has many managers. Private fields never escape.
 const addManager=async(name,space='space-001',status='active',disabled=false)=>{
  const id=randomUUID();await q('insert into papa_accounts(id,disabled_at) values($1,$2)',[id,disabled?'2026-01-01':null]);
  await q('insert into papa_account_legacy_players(account_id,legacy_player_id) values($1,$2)',[id,id]);
  await q("insert into papa_v2_entities(kind,id,data) values('players',$1,$2)",[id,{name,password:'never-return',phone:'private'}]);
  await q("insert into papa_space_memberships(account_id,space_id,role,status) values($1,$2,'space_admin',$3)",[id,space,status]);return id;
 };
 const shared=await addManager('Manager A');
 await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,'space-001','streamer_admin','room-a')",[shared]);
 for(let i=0;i<7;i++)await addManager('Manager '+i);
 await addManager('Suspended','space-001','suspended');await addManager('Disabled','space-001','active',true);
 await addManager('Other tenant','ind');
 const preview=(await read('hall')).rows[0];assert.equal(preview.managerCount,8);assert.equal(preview.managers.length,6);
 assert.equal(new Set(preview.managers.map(m=>m.accountId)).size,6);
 for(const m of preview.managers)assert.deepEqual(Object.keys(m).sort(),['accountId','name']);
 assert.ok(!JSON.stringify(preview).includes('Other tenant'));assert.ok(!JSON.stringify(preview).includes('never-return'));
 assert.equal((await read('independent')).rows[0].managers[0].name,'Other tenant');
 await q("insert into papa_public_route_streamers values('space-001','room-a','UniqueCode')");
 const search=async(text,space=null)=>(await q("select papa_space_center_directory($1,'all',$2,1,$3) value",[president,text,space]))[0].value;
 assert.equal((await search('sm')).rows[0].id,'space-001');
 assert.equal((await search('uniquecode')).rows[0].id,'space-001');
 assert.equal((await search('uniquecode','space-001')).rows[0].id,'room-a');
 assert.equal((await search('uniquecode','ind')).total,0);
 await assert.rejects(read('all',null,1,other),/ACCESS_DENIED/);await assert.rejects(read('all','missing'),/SPACE_NOT_FOUND/);
 await db.exec('set role anon');await assert.rejects(read(),/permission denied/);
});

test('new space categories use one scoped page query and permissions open in a dedicated modal body',async()=>{
 const calls=[];const c=createPlatformManagement({identity:()=> 'president',escape:String,changed:()=>{},api:async b=>{calls.push(b);return b.op==='platformManagementDetail'?{space:{id:'h',name:'Hall'},memberships:[{id:'g',accountId:'a',name:'Manager',role:'streamer_admin',streamerId:'host',status:'active'}],canManageMemberships:true}:{rows:[{id:'h',kind:'hall',name:'Hall',hosts:[],hostCount:0,managerCount:0,status:'active'}],summary:{halls:1,streamerSpaces:0,pendingSetup:1},page:1,pages:1,total:1};}});
 await c.load();assert.equal(calls[0].op,'platformSpaceDirectory');assert.equal(calls[0].category,'all');assert.equal(calls.length,1);
 const html=c.html();for(const label of ['全部空間','獨立主播','管理帳號','＋建立新廳／主播','＋新增廳內主播'])assert.ok(html.includes(label));assert.ok(!html.includes('停用與清理'));
 c.state().rows[0].managerCount=8;c.state().rows[0].managers=[{name:'已綁定管理員'}];
 assert.ok(c.html().includes('已綁定管理員'));assert.ok(c.html().includes('另 7 位'));
 await c.openDetail({id:'h'});c.state().editor.member=c.state().editor.detail.memberships[0];
 const modal=c.html().split('<template data-pm-dialog-content>')[1];assert.ok(modal.includes('data-pm-form="membership"'));assert.ok(!modal.includes('data-pm-form="edit-space"'));assert.ok(modal.includes('返回管理人員'));
});
