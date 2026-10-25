import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const migration='supabase/migrations/20261024222350_platform_management_empty_halls_and_grouped_roles.sql';
export async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('create role anon;create role authenticated;create role service_role;create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,1);');
 await db.exec(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await db.exec("create table papa_manager_account_links(manager_key text primary key,account_id uuid unique references papa_accounts(id));create table papa_streamer_accounts(streamer_id text primary key,enabled boolean);create table papa_events(streamer_id text);insert into papa_space_streamers(streamer_id,space_id) values('room-a','space-001');insert into papa_v2_entities values('meta','1','{\"streamers\":[{\"id\":\"room-a\",\"display_name\":\"Room A\"}]}');");
 for(const p of ['ops/platform-management-proposed.sql','ops/platform-management-directory-proposed.sql',migration])await db.exec(fs.readFileSync(p,'utf8'));
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const president=randomUUID(),other=randomUUID();await q('insert into papa_accounts(id) values($1),($2)',[president,other]);await q("insert into papa_platform_roles(account_id,role) values($1,'president')",[president]);
 const run=(subject,action,payload,id=randomUUID())=>q('select papa_manage_space($1,$2,$3,$4) result',[subject,id,action,payload]).then(r=>r[0].result);
 return {db,q,president,other,run};
}
