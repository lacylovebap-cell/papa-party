// Isolated PostgreSQL validation only. No environment connection URL is used.
// PG17_BIN must point to portable PostgreSQL 17 binaries; no production access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const localRoot=path.join(root,'.local-public-route-validation');
const binaryRoot=path.resolve(process.env.PG17_BIN||path.join(localRoot,'portable','pgsql','bin'));
const port=Number(process.env.PA_PG_TEST_PORT||55439);
assert.ok(Number.isInteger(port)&&port>=49152&&port<=65535,'Use a local test port in 49152..65535');
const suffix=process.platform==='win32'?'.exe':'';
const executable=name=>path.join(binaryRoot,name+suffix);
const cluster=path.join(localRoot,'cluster-'+Date.now());
const log=path.join(cluster,'server.log');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^PG/i.test(key)));
Object.assign(env,{PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'route_fixture',PGDATABASE:'postgres',PGPASSFILE:path.join(localRoot,'nonexistent-password-file'),PGCLIENTENCODING:'UTF8',PGCONNECT_TIMEOUT:'5'});
delete env.DATABASE_URL;delete env.SUPABASE_DB_URL;
const steps=[];let running=false;
function launch(name,args,input=''){
 const child=spawn(executable(name),args,{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='',err='';const listeners=[];
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',part=>{out+=part;for(const f of listeners)f(out);});
 child.stderr.on('data',part=>{err+=part;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve({code,out:out.trim(),err:err.trim()}));});
 child.stdin.end(input);
 return {done,child,waitFor:marker=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Timed out waiting for '+marker)),15000);
   const check=value=>{if(value.includes(marker)){clearTimeout(timer);resolve();}};listeners.push(check);check(out);
   done.then(result=>{if(!result.out.includes(marker)){clearTimeout(timer);reject(new Error(result.err||'Session ended before '+marker));}},reject);
 })};
}
async function run(name,args,input=''){
 // On Windows the background postgres process otherwise inherits pipe handles
 // and keeps the pg_ctl child's close event pending after pg_ctl itself exits.
 if(name==='pg_ctl'){
  const child=spawn(executable(name),args,{cwd:root,env,windowsHide:true,stdio:'ignore'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,'pg_ctl failed; inspect isolated cluster server.log');return '';
 }
 const r=await launch(name,args,input).done;assert.equal(r.code,0,r.err||r.out);return r.out;
}
const psqlArgs=['-X','-w','-qAt','-h','127.0.0.1','-p',String(port),'-U','route_fixture','-d','postgres','-v','ON_ERROR_STOP=1','-f','-'];
const sql=statement=>run('psql',psqlArgs,statement+'\n');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const actor=`'{"account_id":"${A}","role":"streamer_admin","space_id":"space-001","actor_streamer_id":"papa"}'::jsonb`;
const president=`'{"account_id":"${B}","role":"super_admin"}'::jsonb`;
const save=(code,revision)=>`select papa_public_route_save('space-001','papa',${actor},'streamer','${code}',${revision});`;
const business=['papa_accounts','papa_spaces','papa_space_streamers','papa_space_memberships','papa_platform_roles','papa_manager_account_links','papa_streamer_accounts','papa_v2_entities','papa_events','papa_v2_revision'];
const metadata=['papa_public_route_spaces','papa_public_route_streamers','papa_public_route_aliases','papa_public_route_audit'];
async function digest(tables){return sql(tables.map(table=>`select '${table}:'||md5(coalesce(jsonb_agg(t order by t::text),'[]'::jsonb)::text) from (select to_jsonb(x) t from ${table} x) s;`).join('\n'));}
const fixture=`
create role anon;create role authenticated;create role service_role;
create table papa_accounts(id uuid primary key,disabled_at timestamptz);
create table papa_spaces(id text primary key,status text not null);
create table papa_space_streamers(streamer_id text primary key,space_id text references papa_spaces(id),unique(streamer_id,space_id));
create table papa_space_memberships(account_id uuid,space_id text,role text,streamer_id text,status text);
create table papa_platform_roles(account_id uuid,role text);
create table papa_manager_account_links(manager_key text,account_id uuid);
create table papa_streamer_accounts(streamer_id text,enabled boolean);
create table papa_v2_entities(kind text,id text,data jsonb,space_id text);
create table papa_events(id int primary key,data jsonb);
create table papa_v2_revision(id int,revision int);
insert into papa_accounts values('${A}',null),('${B}',null);
insert into papa_spaces values('space-001','active'),('space-002','active');
insert into papa_space_streamers values('papa','space-001'),('other','space-002'),('other2','space-002');
insert into papa_space_memberships values('${A}','space-001','streamer_admin','papa','active');
insert into papa_platform_roles values('${B}','president');
insert into papa_manager_account_links values('president','${B}'),('streamer:papa','${A}');
insert into papa_streamer_accounts values('papa',true);
insert into papa_v2_entities values('meta','1','{"streamers":[{"id":"papa","slug":"papa","active":true},{"id":"other","slug":"other","active":true},{"id":"other2","slug":"other2","active":true}]}',null),('ledger','L1','{"amount":3,"memo":"synthetic-only"}','space-001'),('queue','Q1','{"status":"completed","at":"2026-10-12T12:30:00Z"}','space-001');
insert into papa_events values(1,'{"syntheticAudit":true}');insert into papa_v2_revision values(1,100);
`;
const result={validatedAt:new Date().toISOString(),environment:'isolated-local-postgresql',host:'127.0.0.1',port,productionAccess:false,steps};
try{
 await fs.mkdir(localRoot,{recursive:true});
 result.postgresVersion=await run('postgres',['--version']);
 assert.match(result.postgresVersion,/PostgreSQL\) 17\./);
 await run('initdb',['-D',cluster,'--username=route_fixture','--auth=trust','--encoding=UTF8','--locale=C']);
 await run('pg_ctl',['-D',cluster,'-l',log,'-o',`-h 127.0.0.1 -p ${port} -c max_connections=10 -c shared_buffers=16MB`,'-w','start']);running=true;
 const connection=JSON.parse(await sql("select json_build_object('server_version',current_setting('server_version'),'address',inet_server_addr(),'port',inet_server_port());"));
 assert.equal(connection.address,'127.0.0.1');assert.equal(connection.port,port);result.connection=connection;
 await sql(fixture);const originalBusiness=await digest(business);
 const migration=await fs.readFile(path.join(root,'supabase/migrations/202610190001_public_routes.sql'),'utf8');
 result.migrationSha256=createHash('sha256').update(migration).digest('hex');
 await sql(migration);
 assert.equal(await digest(business),originalBusiness);steps.push({name:'exact-migration-keeps-all-ten-business-tables-identical',passed:true});

 // The first real session saves and holds its transaction open. The second
 // independent psql process must wait on the exact registry advisory lock.
 const first=launch('psql',psqlArgs,`set application_name='public-route-winner';begin;${save('RaceA',0)}\n\\echo HOLDER_LOCKED\nselect pg_sleep(4);commit;\n`);
 await first.waitFor('HOLDER_LOCKED');
 const started=Date.now();
 const second=launch('psql',psqlArgs,`set application_name='public-route-loser';${save('RaceB',0)}\n`);
 let observedLock=false;
 for(let attempt=0;attempt<20;attempt++){
  if(await sql("select exists(select 1 from pg_stat_activity where application_name='public-route-loser' and wait_event_type='Lock' and wait_event='advisory');")==='t'){observedLock=true;break;}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 assert.ok(observedLock,'second real connection must visibly wait on advisory lock');
 const [winner,loser]=await Promise.all([first.done,second.done]);
 assert.equal(winner.code,0,winner.err);assert.notEqual(loser.code,0);assert.match(loser.err,/PUBLIC_ROUTE_VERSION_CONFLICT/);
 assert.equal(await sql("select revision from papa_public_route_spaces where space_id='space-001';"),'1');
 assert.equal(await sql('select count(*) from papa_public_route_audit;'),'1');
 assert.equal(await sql('select count(*) from papa_public_route_aliases;'),'3');
 assert.equal(await sql("select papa_public_route_resolve('/pa')->>'canonicalPath';"),'/RaceA');
 assert.equal(await sql("select papa_public_route_resolve('/RaceB') is null;"),'t');
 steps.push({name:'two-independent-psql-connections-same-revision',passed:true,advisoryWaitObserved:observedLock,winnerCode:winner.code,loserCode:loser.code,loserError:'PUBLIC_ROUTE_VERSION_CONFLICT',waitedMs:Date.now()-started,auditCount:1,aliasCount:3,revision:1});

 const beforeRetry=await digest(metadata);assert.equal(JSON.parse(await sql(save('RaceA',0))).changed,false);assert.equal(await digest(metadata),beforeRetry);
 steps.push({name:'committed-value-retry-no-duplicate-alias-or-audit',passed:true});
 await sql("create function fail_url_audit() returns trigger language plpgsql as $$begin raise exception 'FORCED_AUDIT_FAILURE';end$$;create trigger fail_url_audit before insert on papa_public_route_audit for each row execute function fail_url_audit();");
 const beforeAuditFailure=await digest(metadata);const failed=await launch('psql',psqlArgs,save('MustRollback',1)+'\n').done;
 assert.notEqual(failed.code,0);assert.match(failed.err,/FORCED_AUDIT_FAILURE/);assert.equal(await digest(metadata),beforeAuditFailure);
 await sql('drop trigger fail_url_audit on papa_public_route_audit;');
 steps.push({name:'forced-audit-failure-atomically-rolls-back-code-alias-revision-audit',passed:true});

 const hallSave=(code,revision)=>`select papa_public_route_save('space-002',null,${president},'hall','${code}',${revision},'hall');`;
 await sql(hallSave('qq',0));
 for(const [room,code,revision] of [['other','Singer',1],['other2','Singer2',2]])await sql(`select papa_public_route_save('space-002','${room}',${president},'streamer','${code}',${revision});`);
 await sql("create function fail_url_child() returns trigger language plpgsql as $$begin if new.path_key='/newhall.singer2' then raise exception 'FORCED_CHILD_FAILURE';end if;return new;end$$;create trigger fail_url_child before insert on papa_public_route_aliases for each row execute function fail_url_child();");
 const beforeChildFailure=await digest(metadata);const childFailed=await launch('psql',psqlArgs,hallSave('NewHall',3)+'\n').done;
 assert.notEqual(childFailed.code,0);assert.match(childFailed.err,/FORCED_CHILD_FAILURE/);assert.equal(await digest(metadata),beforeChildFailure);
 steps.push({name:'hall-child-path-failure-rolls-back-entire-hall-rename',passed:true});
 assert.equal(await digest(business),originalBusiness);steps.push({name:'all-original-business-and-audit-fixture-rows-remain-identical-after-validation',passed:true});
 result.passed=true;
}catch(error){result.passed=false;result.error=error.stack;throw error;}
finally{
 if(running){await run('pg_ctl',['-D',cluster,'-m','fast','-w','stop']);result.serverStopped=true;}else result.serverStopped=false;
 const resultPath=path.join(root,'ops/public-routes-postgres-validation-20261019.json');
 await fs.writeFile(resultPath,JSON.stringify(result,null,2)+'\n');
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
