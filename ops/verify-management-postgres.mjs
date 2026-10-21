// Synthetic local database only. No environment connection strings are read.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const base='C:/Users/Administrator/.cache/pa-platform-pg15';
const bin=path.join(base,'package/native/bin'),cluster=path.join(base,'verify-'+Date.now()),port=55441;
const run=(name,args)=>new Promise((resolve,reject)=>{const c=spawn(path.join(bin,name+'.exe'),args,{windowsHide:true,stdio:'ignore'});c.on('error',reject);c.on('exit',code=>code===0?resolve():reject(Error(name+' exit '+code)));});
const frame=(type,payload)=>{const n=Buffer.alloc(4);n.writeInt32BE(payload.length+4);return Buffer.concat([Buffer.from(type),n,payload]);};
async function connect(){
 const socket=net.createConnection({host:'127.0.0.1',port});let buffer=Buffer.alloc(0),pending,rows=[];
 const ready=new Promise((resolve,reject)=>{pending={resolve,reject};});
 socket.on('error',e=>pending?.reject(e));
 socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=5){const length=buffer.readInt32BE(1);if(buffer.length<length+1)return;const type=String.fromCharCode(buffer[0]),body=buffer.subarray(5,length+1);buffer=buffer.subarray(length+1);
  if(type==='D'){let offset=2;const row=[];for(let i=0;i<body.readInt16BE(0);i++){const size=body.readInt32BE(offset);offset+=4;row.push(size<0?null:body.subarray(offset,offset+size).toString());if(size>=0)offset+=size;}rows.push(row);}
  if(type==='E'){const fields=body.toString().split('\0');const message=fields.find(v=>v.startsWith('M'))?.slice(1);pending.error=Error(message||'Local PostgreSQL error');}
  if(type==='Z'){const p=pending;pending=null;if(p?.error)p.reject(p.error);else p?.resolve(rows);rows=[];}
 }});
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
 const protocol=Buffer.alloc(4);protocol.writeInt32BE(196608);const payload=Buffer.concat([protocol,Buffer.from('user\0management_fixture\0database\0postgres\0client_encoding\0UTF8\0\0')]),length=Buffer.alloc(4);length.writeInt32BE(payload.length+4);socket.write(Buffer.concat([length,payload]));await ready;
 return {query(sql){assert.equal(pending,null);const result=new Promise((resolve,reject)=>pending={resolve,reject});socket.write(frame('Q',Buffer.from(sql+'\0')));return result;},close(){socket.end(frame('X',Buffer.alloc(0)));}};
}
const quote=s=>"'"+s.replaceAll("'","''")+"'",json=v=>quote(JSON.stringify(v))+'::jsonb';
const president='11111111-1111-4111-8111-111111111111',manager='22222222-2222-4222-8222-222222222222';
let a,b,started=false;const checks=[];
try{
 await run('initdb',['-D',cluster,'-U','management_fixture','-A','trust','--no-locale','-E','UTF8']);
 await run('pg_ctl',['-D',cluster,'-l',path.join(cluster,'server.log'),'-o','-h 127.0.0.1 -p '+port+' -c shared_buffers=16MB -c max_connections=8','-w','start']);started=true;
 a=await connect();b=await connect();
 await a.query('create role anon;create role authenticated;create role service_role;create table papa_v2_entities(kind text,id text,data jsonb,primary key(kind,id));create table papa_v2_revision(id int primary key,revision bigint);insert into papa_v2_revision values(1,0);');
 await a.query(fs.readFileSync('supabase/migrations/202610070001_space_foundation.sql','utf8'));
 await a.query(`create table papa_manager_account_links(manager_key text primary key,account_id uuid unique references papa_accounts(id));create table papa_streamer_accounts(streamer_id text primary key,enabled boolean default true);create table papa_events(streamer_id text);insert into papa_space_streamers values('room-a','space-001',now());insert into papa_accounts(id) values('${president}'),('${manager}');insert into papa_platform_roles(account_id,role) values('${president}','president');`);
 for(const file of ['ops/platform-management-proposed.sql','ops/platform-management-directory-proposed.sql','ops/platform-management-session-proposed.sql','ops/platform-management-commit-proposed.sql'])await a.query(fs.readFileSync(file,'utf8'));
 await a.query(`create table commit_probe(value jsonb);create function papa_room_admin_commit(expected bigint,changes jsonb,removed jsonb,actor_context jsonb,notices jsonb,requested_room text) returns bigint language plpgsql set search_path=public as $$ begin insert into commit_probe values(changes);return expected+1;end;$$;`);
 const grant=(revision,permissions)=>`select papa_manage_space('${president}',gen_random_uuid(),'membership',${json({spaceId:'space-001',revision,accountId:manager,role:'streamer_admin',streamerId:'room-a',status:'active',permissions})});`;
 const args={expected:0,changes:[],removed:[],notices:[],requested_room:'room-a',actor_context:{role:'streamer_admin',account_id:manager,space_id:'space-001',actor_streamer_id:'room-a',streamer_id:'room-a',action:'song'}};
 const write=`select papa_management_business_commit('papa_room_admin_commit',${json(args)});`;
 await a.query(grant(0,['songs']));
 await a.query('begin;'+write);
 // A granted write retains Space/membership locks until commit; revoke waits.
 await assert.rejects(b.query("set lock_timeout='200ms';"+grant(1,[])),/lock timeout/);checks.push('inflight-write-serializes-revocation');
 await a.query('commit');await b.query("set lock_timeout='2s';"+grant(1,[]));
 await assert.rejects(a.query(write),/ACCESS_DENIED/);assert.equal((await a.query('select count(*) from commit_probe'))[0][0],'1');checks.push('revocation-prevents-next-write');
 await a.query(grant(2,['songs']));await b.query('begin;'+grant(3,[]));
 await assert.rejects(a.query("set lock_timeout='200ms';"+write),/lock timeout/);await b.query('commit');await assert.rejects(a.query(write),/ACCESS_DENIED/);checks.push('revocation-first-rejects-stale-write');
 // Two managers reusing the same Space revision cannot both change metadata.
 await a.query("begin;select papa_manage_space('"+president+"',gen_random_uuid(),'edit',"+json({spaceId:'space-001',revision:4,name:'First'})+");");
 await assert.rejects(b.query("set lock_timeout='200ms';select papa_manage_space('"+president+"',gen_random_uuid(),'edit',"+json({spaceId:'space-001',revision:4,name:'Second'})+");"),/lock timeout/);
 await a.query('commit');await assert.rejects(b.query("select papa_manage_space('"+president+"',gen_random_uuid(),'edit',"+json({spaceId:'space-001',revision:4,name:'Second'})+");"),/VERSION_CONFLICT/);checks.push('concurrent-edit-cas');
 console.log(JSON.stringify({postgres:'15',syntheticOnly:true,checks,passed:checks.length}));
 fs.writeFileSync('ops/platform-management-postgres-result.json',JSON.stringify({syntheticOnly:true,checks,passed:checks.length,at:new Date().toISOString()},null,2));
}finally{a?.close();b?.close();if(started)await run('pg_ctl',['-D',cluster,'-m','fast','-w','stop']);}
