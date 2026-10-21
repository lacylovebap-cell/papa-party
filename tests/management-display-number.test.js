import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
test('display numbering preserves Account UUIDs, is stable and never reuses deleted numbers',async t=>{
 const db=new PGlite();t.after(()=>db.close());const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('create role anon;create role authenticated;create role service_role;create table papa_accounts(id uuid primary key default gen_random_uuid(),disabled_at timestamptz);create table papa_platform_roles(account_id uuid,role text);create table papa_manager_account_links(account_id uuid,manager_key text);');
 const ids=(await q('insert into papa_accounts select gen_random_uuid(),null from generate_series(1,3) returning id')).map(r=>r.id);
 await q("insert into papa_platform_roles values($1,'president');",[ids[0]]);await q("insert into papa_manager_account_links values($1,'president')",[ids[0]]);
 await db.exec(fs.readFileSync('ops/management-display-number-proposed.sql','utf8'));
 assert.deepEqual((await q('select id from papa_accounts')).map(r=>r.id).sort(),[...ids].sort());
 const before=await q('select id,display_number from papa_accounts order by display_number');assert.deepEqual(before.map(r=>r.display_number),[1,2,3]);
 assert.deepEqual(await q('select id,display_number from papa_accounts order by display_number'),before);
 await q('delete from papa_accounts where id=$1',[ids[2]]);assert.equal((await q('insert into papa_accounts default values returning display_number'))[0].display_number,4);
 const numbers=(await q('select papa_management_account_numbers($1,$2) result',[ids[0],[ids[0]]]))[0].result;assert.equal(numbers[ids[0]],'001');
 await assert.rejects(q('select papa_management_account_numbers($1,$2)',[ids[1],ids]),/ACCESS_DENIED/);
 await db.exec('set role anon');await assert.rejects(q('select papa_management_account_numbers($1,$2)',[ids[0],ids]),/permission denied/);
});
