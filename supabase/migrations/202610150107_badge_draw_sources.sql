begin;
create or replace function public.papa_achievement_draw_event() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare player text;event_key text;eligible_request boolean=false;eligible_completion boolean=false;
begin
 if new.action in ('migrate','import') or new.action like 'import:%' then return new;end if;
 player=coalesce(new.after_data->>'playerId',new.before_data->>'playerId');
 if player is null or new.space_id is null or not public.papa_achievement_player_valid(new.space_id,player)
  or coalesce(new.after_data->'test','false')='true' or coalesce(new.after_data->'selfProvided','false')='true'
  or coalesce(new.after_data->>'source','manual')<>'manual' or nullif(new.after_data->>'voided_at','') is not null
  or nullif(new.after_data->>'performance_duplicate_of','') is not null then return new;end if;
 if new.entity_kind='queue' then
  event_key=new.entity_id;
  eligible_request=new.after_data->>'kind'='live' and public.papa_accounting_time(new.after_data->>'acceptedAt') is not null
   and public.papa_accounting_time(new.before_data->>'acceptedAt') is null and new.after_data->>'status' in ('waiting','completed','stored');
  eligible_completion=new.after_data->>'kind' in ('live','saved') and new.after_data->>'status'='completed'
   and new.before_data->>'status' is distinct from 'completed';
 elsif new.entity_kind='ledger' then
  event_key='credit:'||new.entity_id;
  eligible_request=new.before_data is null and new.after_data->>'accounting_kind'='receipt'
   and coalesce(new.after_data->'conversion','false')<>'true' and coalesce(new.after_data->'excludeStats','false')<>'true'
   and coalesce(new.after_data->'openingBalance','false')<>'true' and coalesce(new.after_data->'accounting_adjustment','false')<>'true'
   and nullif(new.after_data->>'correction_of','') is null and (new.after_data->>'amount')::numeric>0;
 end if;
 if eligible_request then
  insert into public.papa_achievement_request_draws values(new.space_id,new.streamer_id,event_key,player,
   ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint<42949673,
   ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint<4294968,new.id,now()) on conflict do nothing;
 end if;
 if eligible_completion then
  insert into public.papa_achievement_draws values(new.space_id,new.streamer_id,event_key,player,
   ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint<21474836,new.id,now()) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger papa_achievement_credit_draw_after_event after insert on public.papa_events
 for each row when(new.entity_kind='ledger') execute function public.papa_achievement_draw_event();
revoke all on function public.papa_achievement_draw_event() from public,anon,authenticated,service_role;
alter function public.papa_achievement_visibility_set(text,text,jsonb,text,text) rename to papa_achievement_visibility_set_badge_legacy;
create function public.papa_achievement_visibility_set(requested_space text,requested_room text,actor_context jsonb,requested_code text,requested_visibility text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb;c record;
begin
 ctx=public.papa_notice_category_scope(requested_space,requested_room,actor_context,'room');
 if ctx->>'recipient' not in ('__admin__','__super__') then raise exception 'ACHIEVEMENT_MANAGER_REQUIRED';end if;
 select badge_id,default_visibility into c from public.papa_achievement_catalog where code=requested_code;
 if left(c.badge_id,1) in ('H','L') and requested_visibility is distinct from c.default_visibility then raise exception 'BADGE_VISIBILITY_FIXED';end if;
 return public.papa_achievement_visibility_set_badge_legacy(requested_space,requested_room,actor_context,requested_code,requested_visibility);
end $$;
revoke all on function public.papa_achievement_visibility_set_badge_legacy(text,text,jsonb,text,text) from public,anon,authenticated,service_role;
revoke all on function public.papa_achievement_visibility_set(text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.papa_achievement_visibility_set(text,text,jsonb,text,text) to service_role;
commit;
