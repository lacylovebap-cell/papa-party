// Builds one throwaway PostgreSQL database with the repository's complete schema
// (every migration in order, plus the production-approved management release that
// lives under ops/), so Edge tests can run against the real functions.
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migrationsDir=new URL('../../supabase/migrations/',import.meta.url);
const opsApproved=new URL('../../ops/platform-management-approved-release.sql',import.meta.url);
const BEFORE='20261024222350_platform_management_empty_halls_and_grouped_roles.sql';

const prelude=`
create role anon;create role authenticated;create role service_role;
create extension if not exists pgcrypto;create extension if not exists pg_trgm;
create schema if not exists auth;create table auth.users(id uuid primary key default gen_random_uuid(),encrypted_password text,email text);
create schema if not exists storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);
create table public.party_state(id int primary key,data jsonb);
create schema net;create function net.http_post(url text,body jsonb default null,params jsonb default null,headers jsonb default null,timeout_milliseconds int default 5000) returns bigint language sql as 'select 1::bigint';
create schema cron;create function cron.schedule(job text,schedule text,command text) returns bigint language sql as 'select 1::bigint';`;

function prepare(name,sql){
 sql=sql.replace(/create extension[^;]*pg_net[^;]*;/gi,'').replace(/create extension[^;]*pg_cron[^;]*;/gi,'');
 if(name==='202609170001_party_v2.sql'&&sql.includes('insert into storage.buckets'))sql=sql.slice(0,sql.indexOf('insert into storage.buckets'));
 return sql;
}

export async function createFullSchemaDb(t,{president_password='president-secret-2026'}={}){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(prelude);
 const files=fs.readdirSync(migrationsDir).filter(name=>name.endsWith('.sql')).sort();
 for(const name of files){
  if(name===BEFORE)await db.exec(fs.readFileSync(opsApproved,'utf8'));
  try{await db.exec(prepare(name,fs.readFileSync(new URL(name,migrationsDir),'utf8')));}
  catch(error){error.message=name+': '+error.message;throw error;}
 }
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await q('insert into party_state values(1,$1) on conflict(id) do update set data=excluded.data',[{settings:{adminPassword:president_password}}]);
 return {db,q,rpc:async(name,args=[])=>(await q('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args))[0].result};
}
