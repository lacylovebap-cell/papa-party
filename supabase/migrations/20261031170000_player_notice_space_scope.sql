-- 10.31-NOTICE.4: players read one message centre for every streamer of their Space
-- (rows already carry streamer_name). The category page/count/read functions already
-- filter by recipient for 'space'; only this scope check kept players out.
create or replace function public.papa_notice_category_scope(requested_space text, requested_room text, actor_context jsonb, scope_mode text DEFAULT 'room'::text)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare ctx jsonb;owner_id text;pref_room text;
begin
 if requested_space is null or length(requested_space) not between 1 and 128
  or requested_room is null or length(requested_room) not between 1 and 200
  or jsonb_typeof(actor_context) is distinct from 'object'
  or scope_mode is null or scope_mode not in ('room','space')
 then raise exception 'NOTICE_SCOPE_INVALID';end if;
 ctx=public.papa_communication_context(requested_space,requested_room,actor_context);
 if scope_mode='space' and ctx->>'role' not in ('admin','super_admin','player')
 then raise exception 'NOTICE_SCOPE_INVALID';end if;
 owner_id=case ctx->>'role' when 'player' then ctx->>'player_id'
  when 'streamer_admin' then '__admin__' else '__super__' end;
 if owner_id is null or owner_id='' then raise exception 'NOTICE_ACTOR_INVALID';end if;
 pref_room=case when owner_id='__super__' then '__global__' else requested_room end;
 return jsonb_build_object('spaceId',requested_space,'streamerId',case when scope_mode='room' then requested_room else null end,
  'mode',scope_mode,'recipient',owner_id,'preferencesRoom',pref_room);
end $function$;
