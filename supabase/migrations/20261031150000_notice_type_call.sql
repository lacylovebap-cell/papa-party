-- 10.31-CALL.1: new notification type 'call' (主播呼叫). Additive: both functions keep
-- every existing type and only learn 'call'. No table, data or trigger change.
create or replace function public.papa_notice_preference_type(notice_type text)
 returns text language sql immutable set search_path to 'public' as $function$
 select case when notice_type in ('live','saved','cancel','ready','call','accepted','completed','credit','status','failed',
  'message','comment','announcement','achievement','wish','system','delivery') then notice_type else 'system' end;
$function$;
create or replace function public.papa_notice_center_preferences_set(requested_space text, requested_room text, actor_context jsonb, scope_mode text DEFAULT 'room'::text, display_settings jsonb DEFAULT NULL::jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare scope jsonb;entry record;pref jsonb;result jsonb;
begin
 scope=papa_notice_category_scope(requested_space,requested_room,actor_context,scope_mode);
 if display_settings is not null then
  if jsonb_typeof(display_settings) is distinct from 'object' or display_settings-'types'<>'{}'::jsonb
   or jsonb_typeof(display_settings->'types') is distinct from 'object'
  then raise exception 'NOTICE_CENTER_SETTINGS_INVALID';end if;
  for entry in select key,value from jsonb_each(display_settings->'types') loop
   if papa_notice_preference_type(entry.key)<>entry.key or jsonb_typeof(entry.value) is distinct from 'object'
    or entry.value-'center'-'badge'<>'{}'::jsonb or jsonb_typeof(entry.value->'center') is distinct from 'boolean'
    or jsonb_typeof(entry.value->'badge') is distinct from 'boolean'
   then raise exception 'NOTICE_CENTER_SETTINGS_INVALID';end if;
  end loop;
  insert into papa_notice_center_preferences(space_id,scope_mode,room_id,account_id,actor_role,recipient,settings)
   values(requested_space,scope_mode,case when scope_mode='space' then '' else requested_room end,
    (actor_context->>'account_id')::uuid,actor_context->>'role',scope->>'recipient',display_settings)
   on conflict on constraint papa_notice_center_preferences_pkey do update set settings=excluded.settings,updated_at=now();
 end if;
 pref=papa_notice_center_preferences_json(requested_space,requested_room,actor_context,scope_mode);
 select coalesce(jsonb_object_agg(t,jsonb_build_object('center',(pref->'types'->t->>'center') is distinct from 'false',
  'badge',(pref->'types'->t->>'badge') is distinct from 'false')),'{}'::jsonb) into result
 from unnest(array['live','saved','cancel','ready','call','accepted','completed','credit','status','failed','message','comment','announcement','achievement','wish','system','delivery']) t;
 return jsonb_build_object('version',1,'scope',scope-'recipient'-'preferencesRoom','settings',jsonb_build_object('types',result));
end $function$;
