begin;
-- Player-controlled publication only. No award, ledger, queue or balance backfill.
create table public.papa_achievement_public_choices(
 space_id text not null,streamer_id text not null,account_id uuid not null,player_id text not null,
 code text not null references public.papa_achievement_catalog(code),
 enabled boolean not null default true,verified_qualified boolean not null default false,
 published_at timestamptz not null default now(),changed_at timestamptz not null default now(),
 primary key(space_id,streamer_id,account_id,code)
);
create index papa_achievement_public_choices_account on public.papa_achievement_public_choices(account_id,space_id,streamer_id);
alter table public.papa_achievement_public_choices enable row level security;
revoke all on public.papa_achievement_public_choices from public,anon,authenticated,service_role;

create function public.papa_achievement_public_state(requested_space text,requested_room text,actor_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if actor_context->>'role'<>'player' or ctx->>'recipient' is distinct from actor_context->>'player_id'
  or nullif(actor_context->>'account_id','') is null then raise exception 'ACHIEVEMENT_PLAYER_REQUIRED';end if;
 return coalesce((select jsonb_object_agg(code,enabled) from public.papa_achievement_public_choices
  where space_id=requested_space and streamer_id=requested_room and account_id=(actor_context->>'account_id')::uuid),'{}'::jsonb);
end $$;

create function public.papa_achievement_public_set(requested_space text,requested_room text,actor_context jsonb,requested_code text,requested_enabled boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;player text;account uuid;item record;flags jsonb;qualified boolean;recorded boolean;prior boolean;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 player=actor_context->>'player_id';
 if actor_context->>'role'<>'player' or ctx->>'recipient' is distinct from player or nullif(actor_context->>'account_id','') is null
  or not public.papa_achievement_player_valid(requested_space,player,true) then raise exception 'ACHIEVEMENT_PLAYER_REQUIRED';end if;
 account=(actor_context->>'account_id')::uuid;
 if requested_enabled is null or requested_code is null then raise exception 'ACHIEVEMENT_PUBLIC_INVALID';end if;
 select c.lifetime,coalesce(v.visibility,c.default_visibility) visibility into item
 from public.papa_achievement_catalog c left join public.papa_achievement_visibility v
 on v.space_id=requested_space and v.streamer_id=requested_room and v.code=c.code where c.code=requested_code;
 if not found or item.visibility='hidden' then raise exception 'ACHIEVEMENT_PUBLIC_INVALID';end if;
 select enabled into prior from public.papa_achievement_public_choices
 where space_id=requested_space and streamer_id=requested_room and account_id=account and code=requested_code for update;
 if prior is not distinct from requested_enabled then return jsonb_build_object('ok',true,'published',requested_enabled);end if;
 if requested_enabled then
  flags=public.papa_achievement_eligibility(requested_space,requested_room,player);
  qualified=coalesce((flags->>requested_code)::boolean,false);
  select exists(select 1 from public.papa_achievement_awards a
   where a.space_id=requested_space and a.streamer_id=requested_room and a.player_id=player and a.code=requested_code) into recorded;
  if not qualified and not recorded then raise exception 'ACHIEVEMENT_NOT_EARNED';end if;
  -- Older unrecorded temporary states have no durable acquisition evidence.
  if not recorded and item.lifetime<>'permanent' then raise exception 'ACHIEVEMENT_AWARD_NOT_RECORDED';end if;
 else qualified=false;end if;
 insert into public.papa_achievement_public_choices(space_id,streamer_id,account_id,player_id,code,enabled,verified_qualified)
 values(requested_space,requested_room,account,player,requested_code,requested_enabled,qualified)
 on conflict(space_id,streamer_id,account_id,code) do update
 set player_id=excluded.player_id,enabled=excluded.enabled,verified_qualified=excluded.verified_qualified,
  changed_at=now(),published_at=case when excluded.enabled then now() else public.papa_achievement_public_choices.published_at end;
 insert into public.papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_account_id,actor_player_id,space_id,before_data,after_data)
 values(requested_room,'achievement',requested_code,'achievement_public_choice','player',account,player,requested_space,
  jsonb_build_object('enabled',coalesce(prior,false)),jsonb_build_object('enabled',requested_enabled));
 return jsonb_build_object('ok',true,'published',requested_enabled);
end $$;

create or replace function public.papa_achievement_public_rows()
returns table(player_key text,account_id uuid,space_id text,streamer_id text,player_id text,player_name text,streamer_name text,code text,name text,lifetime text,visibility text,condition_text text,acquired_at timestamptz,recorded_active boolean)
language sql stable security definer set search_path=pg_catalog,public as $$
 with profiles as (
  select b.account_id,'space-001'::text space_id,p.id player_id,p.data from public.papa_account_legacy_players b
  join public.papa_v2_entities p on p.kind='players' and p.id=b.legacy_player_id
  union all select account_id,space_id,player_id,data from public.papa_space_player_profiles
 ),rooms as(select r->>'id' id,r->>'spaceId' space_id,r->>'display_name' name
  from jsonb_array_elements(public.papa_streamer_directory()) r where coalesce((r->>'active')::boolean,true))
 select md5('public-medals:'||p.account_id::text),p.account_id,o.space_id,o.streamer_id,o.player_id,
  coalesce(nullif(p.data->>'name',''),'玩家'),r.name,c.code,c.name,c.lifetime,
  coalesce(v.visibility,c.default_visibility),
  case when coalesce(v.visibility,c.default_visibility)='condition_hidden' then null else c.condition_text end,
  award.acquired_at,coalesce(award.recorded_active,o.verified_qualified)
 from public.papa_achievement_public_choices o
 join profiles p on p.space_id=o.space_id and p.player_id=o.player_id and p.account_id=o.account_id
 join public.papa_accounts account on account.id=o.account_id and account.disabled_at is null
 join public.papa_space_memberships membership on membership.account_id=o.account_id and membership.space_id=o.space_id
  and membership.role='player' and membership.status='active'
 join public.papa_spaces s on s.id=o.space_id and s.status='active'
 join rooms r on r.id=o.streamer_id and r.space_id=o.space_id
 join public.papa_achievement_catalog c on c.code=o.code
 left join public.papa_achievement_visibility v on v.space_id=o.space_id and v.streamer_id=o.streamer_id and v.code=o.code
 left join lateral (
  select min(a.acquired_at) acquired_at,
   bool_or(a.active and (c.lifetime<>'show' or a.period=((now() at time zone 'Asia/Taipei')-make_interval(hours=>s.accounting_rollover_hour))::date::text)) recorded_active
  from public.papa_achievement_awards a where a.space_id=o.space_id and a.streamer_id=o.streamer_id
   and a.player_id=o.player_id and a.code=o.code
 ) award on true
 where o.enabled and coalesce(p.data->'archived','false')<>'true'::jsonb
  and coalesce(p.data->'test','false')<>'true'::jsonb
  and coalesce(v.visibility,c.default_visibility)<>'hidden'
  and (award.acquired_at is not null or c.lifetime='permanent' and o.verified_qualified);
$$;
create function public.papa_achievement_public_refresh() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare player text;flags jsonb;
begin
 if new.entity_kind not in ('queue','ledger') or new.action in ('migrate','import') or new.action like 'import:%' then return new;end if;
 player=case when new.action='request_failed' then new.actor_player_id else coalesce(new.after_data->>'playerId',new.before_data->>'playerId') end;
 if player is null or new.space_id is null or not exists(
  select 1 from public.papa_achievement_public_choices o where o.space_id=new.space_id and o.streamer_id=new.streamer_id
   and o.player_id=player and o.enabled) then return new;end if;
 flags=public.papa_achievement_eligibility(new.space_id,new.streamer_id,player);
 update public.papa_achievement_public_choices o
 set verified_qualified=coalesce((flags->>o.code)::boolean,false),changed_at=now()
 from public.papa_achievement_catalog c
 where c.code=o.code and c.lifetime='permanent' and o.space_id=new.space_id and o.streamer_id=new.streamer_id
  and o.player_id=player and o.enabled
  and coalesce((flags->>o.code)::boolean,false) is distinct from o.verified_qualified;
 return new;
end $$;
create constraint trigger papa_achievement_public_refresh after insert on public.papa_events deferrable initially deferred
 for each row when (new.entity_kind in ('queue','ledger')) execute function public.papa_achievement_public_refresh();
revoke all on function public.papa_achievement_public_refresh() from public,anon,authenticated,service_role;
revoke all on function public.papa_achievement_public_state(text,text,jsonb),public.papa_achievement_public_set(text,text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.papa_achievement_public_state(text,text,jsonb),public.papa_achievement_public_set(text,text,jsonb,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
