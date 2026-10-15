-- Temporary deployment export only; no persistent RPC or business write.
create or replace function pg_temp.papa_badge_export()
returns jsonb language plpgsql stable as $$
declare room record;k text;page jsonb;state jsonb;rooms jsonb='[]';cursor_id text;source_revision bigint;fact_count integer=0;
begin
 select revision into source_revision from public.papa_v2_revision where id=1;
 for room in select value->>'spaceId' space_id,value->>'streamerId' room_id from jsonb_array_elements(public.papa_badge_replay_rooms()) loop
  state=jsonb_build_object('spaceId',room.space_id,'streamerId',room.room_id,'revision',source_revision,'asOf',now(),'queue','[]'::jsonb,'ledger','[]'::jsonb,'players','[]'::jsonb);
  foreach k in array array['queue','ledger','players'] loop
   cursor_id='';
   loop
    page=public.papa_badge_replay_page(room.space_id,room.room_id,k,cursor_id,source_revision);
    state=jsonb_set(state,array[k],(state->k)||coalesce((select jsonb_agg(element->'data') from jsonb_array_elements(page->'rows')element),'[]'));
    fact_count=fact_count+jsonb_array_length(page->'rows');
    if fact_count>10000 then raise exception 'BADGE_EXPORT_SIZE_REVIEW_REQUIRED';end if;
    cursor_id=page->>'nextCursor';exit when cursor_id is null;
   end loop;
  end loop;
  rooms=rooms||jsonb_build_array(state);
 end loop;
 return jsonb_build_object('rooms',rooms);
end $$;
select pg_temp.papa_badge_export() as payload;
