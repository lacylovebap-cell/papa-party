import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table papa_accounts(id uuid primary key,disabled_at timestamptz);
 create table papa_account_legacy_players(account_id uuid,legacy_player_id text);
 create table papa_space_player_profiles(space_id text,player_id text,account_id uuid,data jsonb);
 create table papa_v2_entities(kind text,id text,data jsonb,space_id text,primary key(kind,id));
 create table papa_spaces(id text primary key,status text,accounting_rollover_hour int);
 create table papa_v2_revision(id int primary key,revision bigint);
 insert into papa_v2_revision values(1,42);
 create table papa_space_streamers(streamer_id text,space_id text);
 create table papa_space_memberships(account_id uuid,space_id text,role text,status text);
 create function papa_streamer_directory() returns jsonb language sql as $$select '[{"id":"papa","spaceId":"space-001","display_name":"Pa","active":true},{"id":"other","spaceId":"space-002","display_name":"Other","active":true}]'::jsonb$$;
 create function papa_streamer_directory_in_space(s text) returns jsonb language sql as $$select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(papa_streamer_directory()) r where r->>'spaceId'=s$$;
 create table papa_events(id bigint generated always as identity primary key,streamer_id text,entity_kind text,entity_id text,
 action text,actor_role text,actor_player_id text,created_at timestamptz default now(),effective_at text,before_data jsonb,after_data jsonb,
 hour_bucket bigint,actor_account_id uuid,actor_streamer_id text,target_player_id text,space_id text);
 create unique index failed_hour on papa_events(streamer_id,actor_player_id,hour_bucket) where action='request_failed';
 create table papa_notifications(id uuid default gen_random_uuid(),streamer_id text,streamer_name text,recipient text,type text,level int,body text,entity_id text,space_id text);
 create function papa_accounting_time(value text) returns timestamptz language plpgsql immutable as $$begin return value::timestamptz;exception when others then return null;end$$;
 create function papa_notice_category_scope(s text,r text,a jsonb,m text) returns jsonb language plpgsql stable as $$begin
 if a->>'role'='streamer_admin' and a->>'actor_streamer_id' is distinct from r then raise exception 'ROOM_DENIED';end if;
 if a->>'space_id' is distinct from s or a->>'role' not in ('player','streamer_admin','super_admin') then raise exception 'SCOPE_INVALID';end if;
 return jsonb_build_object('recipient',case a->>'role' when 'player' then a->>'player_id' when 'streamer_admin' then '__admin__' else '__super__' end);end$$;
 insert into papa_accounts values('11111111-1111-4111-8111-111111111111',null);
 insert into papa_space_memberships values('11111111-1111-4111-8111-111111111111','space-001','player','active'),('11111111-1111-4111-8111-111111111111','space-002','player','active');
 insert into papa_account_legacy_players values('11111111-1111-4111-8111-111111111111','P1');
 insert into papa_space_player_profiles values('space-002','P2','11111111-1111-4111-8111-111111111111','{"name":"one"}');
 insert into papa_spaces values('space-001','active',19),('space-002','active',19);
 insert into papa_space_streamers values('papa','space-001'),('other','space-002');
 insert into papa_v2_entities values('players','P1','{"name":"one"}',null),('meta','1','{"streamers":[{"id":"papa","display_name":"Pa"}]}',null);`);
 for(const file of ['202610140001_achievements.sql','202610140006_achievement_collection.sql','202610140007_achievement_public_choices.sql','202610140008_achievement_manual_certification.sql',
 '202610150100_badge_catalog.sql','202610150101_badge_award_rules.sql','202610150102_badge_failures_and_draws.sql','202610150103_badge_atlas.sql','202610150104_badge_rankings.sql','202610150105_badge_show_settlement.sql','202610150106_badge_release_replay.sql','202610150107_badge_draw_sources.sql'])
  await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const put=async(id,data,space='space-001')=>q("insert into papa_v2_entities values('queue',$1,$2,$3) on conflict(kind,id) do update set data=excluded.data",[id,data,space]);
 for(const name of ['202610160001_medal_management.sql','202610160002_medal_public_views.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 return {db,q,put};
}
