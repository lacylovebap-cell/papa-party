import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {randomUUID} from 'node:crypto';
test('isolated management proposal: atomic creation, replay, scoped grants, revocation, audit and preservation',async t=>{
 const db=new PGlite();t.after(()=>db.close());const q=async(s,a=[])=>(await db.query(s,a)).rows;
 await db.exec('create role anon;create role authenticated;create role service_role;create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,7);');
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec("create table papa_manager_account_links(manager_key text primary key,account_id uuid unique references papa_accounts(id));");
 const before=await q('select * from papa_spaces');
 await db.exec(fs.readFileSync('ops/platform-management-proposed.sql','utf8'));
 await db.exec(fs.readFileSync('ops/platform-management-directory-proposed.sql','utf8'));
 for(const old of before){const row=(await q('select * from papa_spaces where id=$1',[old.id]))[0];for(const key of Object.keys(old))assert.deepEqual(row[key],old[key]);}
 const account=async()=>(await q('insert into papa_accounts default values returning id'))[0].id;
 const president=await account(),owner=await account(),delegate=await account(),outsider=await account();await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 const run=(who,action,payload,op=randomUUID())=>q('select papa_manage_space($1,$2,$3,$4) result',[who,op,action,payload]).then(r=>r[0].result);
 const payload={name:'Isolated Hall',kind:'hall',ownerAccountId:owner},op=randomUUID();
 await assert.rejects(run(outsider,'create',payload),/ACCESS_DENIED/);
 const hall=await run(president,'create',payload,op);assert.equal(hall.status,'suspended');assert.equal(hall.owner_account_id,owner);
 const overview=(await q("select papa_management_directory($1,'overview','',1) data",[president]))[0].data;assert.equal(overview.summary.halls,1);assert.equal(overview.summary.unclassified,1);
 const listing=(await q("select papa_management_directory($1,'halls','Isolated',1) data",[president]))[0].data;assert.equal(listing.rows[0].id,hall.id);
 await assert.rejects(q("select papa_management_directory($1,'halls','',1)",[owner]),/ACCESS_DENIED/); // unprovisioned suspended tenant
 assert.deepEqual(await run(president,'create',payload,op),hall);assert.equal((await q('select count(*) n from papa_management_audit'))[0].n,1);
 await assert.rejects(run(president,'create',{...payload,name:'Different'},op),/OPERATION_CONFLICT/);
 await q("update papa_spaces set status='active' where id=$1",[hall.id]); // isolated fixture only; activation is not exposed by the proposal.
 assert.equal((await q("select papa_management_directory($1,'halls','',1) data",[owner]))[0].data.rows[0].id,hall.id);
 const grant={spaceId:hall.id,revision:0,accountId:delegate,status:'active',permissions:['songs','administrators']};await run(owner,'membership',grant);
 await assert.rejects(run(delegate,'membership',{...grant,revision:1,accountId:outsider,permissions:['reports']}),/ESCALATION/);
 await run(delegate,'membership',{...grant,revision:1,accountId:outsider,permissions:['songs']});
 await assert.rejects(run(outsider,'edit',{spaceId:hall.id,revision:2,name:'Hijacked'}),/ACCESS_DENIED/);
 await run(owner,'membership',{...grant,revision:2,status:'suspended'});
 await assert.rejects(run(delegate,'membership',{...grant,revision:3,accountId:outsider}),/ACCESS_DENIED/);
 await assert.rejects(run(owner,'membership',{...grant,revision:3,accountId:owner,status:'suspended'}),/OWNER_TRANSFER/);
 const count=(await q('select count(*) n from papa_management_audit'))[0].n;
 await db.exec("create function fail_management_audit() returns trigger language plpgsql as $$begin raise exception 'audit failed';end$$;create trigger fail_audit before insert on papa_management_audit for each row execute function fail_management_audit();");
 await assert.rejects(run(owner,'edit',{spaceId:hall.id,revision:3,name:'Must rollback'}),/audit failed/);
 assert.equal((await q('select display_name from papa_spaces where id=$1',[hall.id]))[0].display_name,'Isolated Hall');assert.equal((await q('select count(*) n from papa_management_audit'))[0].n,count);
 await db.exec('set role authenticated');await assert.rejects(run(president,'create',payload),/permission denied/);await db.exec('reset role');
});
