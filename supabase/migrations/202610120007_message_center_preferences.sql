begin;
-- Only display/badge overrides for the selected authenticated center scope.
-- Existing delivery, audio and push preferences remain untouched.
create table public.papa_notice_center_preferences(
 space_id text not null,scope_mode text not null check(scope_mode in ('room','space')),
 room_id text not null,account_id uuid not null,actor_role text not null,recipient text not null,
 settings jsonb not null,updated_at timestamptz not null default now(),
 primary key(space_id,scope_mode,room_id,account_id,actor_role,recipient)
);
alter table public.papa_notice_center_preferences enable row level security;
revoke all on public.papa_notice_center_preferences from public,anon,authenticated;
grant select,insert,update on public.papa_notice_center_preferences to service_role;

create function public.papa_notice_center_preferences_json(requested_space text,requested_room text,
 actor_context jsonb,scope_mode text default 'room') returns jsonb
 language plpgsql stable security definer set search_path=public as $$
declare scope jsonb;pref jsonb;overrides jsonb;entry record;types jsonb;
begin
 scope=papa_notice_category_scope(requested_space,requested_room,actor_context,scope_mode);
 select preferences into pref from papa_notice_preferences where streamer_id=scope->>'preferencesRoom' and recipient=scope->>'recipient';
 pref=coalesce(pref,'{}'::jsonb);types=coalesce(pref->'types','{}'::jsonb);
 select settings into overrides from papa_notice_center_preferences
  where space_id=requested_space and papa_notice_center_preferences.scope_mode=papa_notice_center_preferences_json.scope_mode
   and room_id=case when papa_notice_center_preferences_json.scope_mode='space' then '' else requested_room end
   and account_id=(actor_context->>'account_id')::uuid and actor_role=actor_context->>'role' and recipient=scope->>'recipient';
 for entry in select key,value from jsonb_each(coalesce(overrides->'types','{}'::jsonb)) loop
  types=jsonb_set(types,array[entry.key],coalesce(types->entry.key,'{}'::jsonb)||entry.value,true);
 end loop;
 return pref||jsonb_build_object('types',types);
end $$;

create function public.papa_notice_center_preferences_set(requested_space text,requested_room text,
 actor_context jsonb,scope_mode text default 'room',display_settings jsonb default null)
 returns jsonb language plpgsql security definer set search_path=public as $$
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
 from unnest(array['live','saved','cancel','ready','accepted','completed','credit','status','failed','message','comment','announcement','achievement','wish','system','delivery']) t;
 return jsonb_build_object('version',1,'scope',scope-'recipient'-'preferencesRoom','settings',jsonb_build_object('types',result));
end $$;

-- Replace only the preference lookup in the three new category functions.
do $$declare f regprocedure;definition text;needle text:=E'select preferences into pref from public.papa_notice_preferences\n  where streamer_id=scope->>''preferencesRoom'' and recipient=scope->>''recipient'';';begin
 foreach f in array array['public.papa_notice_category_page(text,text,jsonb,text,integer,text,timestamp with time zone,uuid)'::regprocedure,
  'public.papa_notice_category_counts(text,text,jsonb,text)'::regprocedure,'public.papa_notice_category_read(text,text,jsonb,text,uuid[],text)'::regprocedure] loop
  definition=replace(pg_get_functiondef(f),E'\r\n',E'\n');
  if strpos(definition,needle)=0 then raise exception 'NOTICE_CENTER_BASE_DEFINITION_CHANGED';end if;
  execute replace(definition,needle,'pref=public.papa_notice_center_preferences_json(requested_space,requested_room,actor_context,scope_mode);');
 end loop;
end $$;
revoke all on function public.papa_notice_center_preferences_json(text,text,jsonb,text),
 public.papa_notice_center_preferences_set(text,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.papa_notice_center_preferences_set(text,text,jsonb,text,jsonb) to service_role;
commit;
