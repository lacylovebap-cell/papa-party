import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {groupManagementRoles} from '../src/management-role-groups.js';
import {createPlatformManagement} from '../src/platform-management.js';
import {fixture} from './platform-membership-fixture.js';
test('group by Account only; preserve individual grant IDs, scope, permissions and source objects',()=>{
 const rows=[{id:'1',accountId:'a',name:'same',role:'space_admin',status:'active',permissions:['songs']},{id:'2',accountId:'a',name:'same',role:'streamer_admin',streamerId:'r',status:'active',permissions:['queue']},{id:'3',accountId:'b',name:'same',role:'streamer_admin',status:'suspended'},{id:'4',name:'same'},{id:'5',name:'same'}];
 const before=JSON.stringify(rows),groups=groupManagementRoles(rows);assert.equal(groups.length,4);assert.deepEqual(groups[0].memberships.map(m=>m.id),['1','2']);assert.equal(groups[0].memberships[0],rows[0]);assert.equal(JSON.stringify(rows),before);
 assert.equal(groupManagementRoles([{accountId:'a',status:'active'},{accountId:'a',status:'suspended'}])[0].status,'mixed');
});
test('empty hall or independent tenant needs no administrator and replay creates nothing twice',async t=>{
 const {q,president,other,run}=await fixture(t);
 for(const kind of ['hall','independent']){const id=randomUUID(),payload={name:'Empty '+kind,kind};const created=await run(president,'create',payload,id);assert.equal(created.owner_account_id,null);assert.equal(created.status,'suspended');assert.equal(created.tenant_kind,kind);assert.deepEqual(await run(president,'create',payload,id),created);assert.equal((await q('select count(*)::int n from papa_space_memberships where space_id=$1',[created.id]))[0].n,0);await assert.rejects(run(president,'restore',{spaceId:created.id,revision:0}),/PROVISIONING_REQUIRED/);}
 await assert.rejects(run(other,'create',{name:'Bad',kind:'hall'}),/ACCESS_DENIED/);
 await assert.rejects(run(president,'create',{name:'Bad',kind:'hall',ownerAccountId:randomUUID()}),/PAYLOAD_INVALID/);
 assert.equal((await q('select count(*)::int n from papa_management_audit'))[0].n,2);
});
test('owner remains optional but a chosen valid owner keeps the existing scoped role; later assignment works',async t=>{
 const {q,president,other,run}=await fixture(t);
 const chosen=await run(president,'create',{name:'Owned',kind:'hall',ownerAccountId:other});assert.equal(chosen.owner_account_id,other);
 assert.equal((await q('select count(*)::int n from papa_space_memberships where space_id=$1 and account_id=$2',[chosen.id,other]))[0].n,1);
 const empty=await run(president,'create',{name:'Later',kind:'hall'});await run(president,'membership',{spaceId:empty.id,revision:0,accountId:other,role:'space_admin',status:'active',permissions:['songs']});
 assert.equal((await q('select permissions from papa_space_memberships where space_id=$1',[empty.id]))[0].permissions[0],'songs');
});
test('database pages 20 Accounts, keeping all roles on the same page; no cross-hall leakage',async t=>{
 const {q,president,other}=await fixture(t);
 for(let i=0;i<21;i++){const account=randomUUID();await q('insert into papa_accounts(id) values($1)',[account]);await q("insert into papa_space_memberships(account_id,space_id,role,streamer_id) values($1,'space-001','space_admin',null),($1,'space-001','streamer_admin','room-a')",[account]);}
 const page=async n=>(await q("select papa_management_detail($1,'space-001',null,'',$2) result",[president,n]))[0].result;
 const a=await page(1),b=await page(2);assert.equal(a.total,21);assert.equal(a.pages,2);assert.equal(a.membershipPageUnit,'account');assert.equal(a.memberships.length,40);assert.equal(b.memberships.length,2);assert.equal(new Set(a.memberships.map(m=>m.accountId)).size,20);assert.ok(!a.memberships.some(m=>m.accountId===b.memberships[0].accountId));
 const controller=createPlatformManagement({api:async()=>a,identity:()=>president,escape:String,changed:()=>{}});await controller.openDetail({id:'space-001'});assert.ok(controller.state().editor);assert.equal((controller.html().match(/class="pm-member"/g)||[]).length,20);assert.equal((controller.html().match(/data-pm-action="edit-membership"/g)||[]).length,40);
 await assert.rejects(q("select papa_management_detail($1,'space-001',null,'',1)",[other]),/ACCESS_DENIED/);
});
test('anonymous cannot call replaced functions and audit failure rolls back new hall',async t=>{
 const {db,q,president,run}=await fixture(t);await db.exec("create function reject_audit() returns trigger language plpgsql as $$begin raise exception 'AUDIT_FAILED';end$$;create trigger reject_audit before insert on papa_management_audit for each row execute function reject_audit();");
 const before=(await q('select count(*)::int n from papa_spaces'))[0].n;await assert.rejects(run(president,'create',{name:'Rollback',kind:'hall'}),/AUDIT_FAILED/);assert.equal((await q('select count(*)::int n from papa_spaces'))[0].n,before);
 await db.exec('set role anon');await assert.rejects(run(president,'create',{name:'Anon',kind:'hall'}),/permission denied/);await assert.rejects(q("select papa_management_detail($1,'space-001')",[president]),/permission denied/);
});
