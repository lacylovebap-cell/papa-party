begin;
-- Future audit writes omit lyric bodies. Existing events stay unchanged; reads
-- apply the same projection in PostgreSQL before transferring them to the API.
create or replace function public.papa_audit_redact(value jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare result jsonb; k text; v jsonb;
begin
 if jsonb_typeof(value)='object' then
  result='{}';
  for k,v in select * from jsonb_each(value) loop
   if k !~* '(password|token|secret|key|lyric)' and k !~* '^private_?notes?$' then
    result=result||jsonb_build_object(k,papa_audit_redact(v));
   end if;
  end loop;
  return result;
 elsif jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(papa_audit_redact(x)),'[]') into result from jsonb_array_elements(value) x;
  return result;
 end if;
 return value;
end $$;

create or replace function public.papa_event_page(room_id text,page_number int default 0,include_global boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rows_json jsonb;
begin
 if coalesce(room_id,'')='' or page_number is null or page_number<0 or page_number>200 then
  raise exception 'EVENT_PAGE_INVALID';
 end if;
 select coalesce(jsonb_agg(papa_audit_redact(to_jsonb(page_rows)) order by created_at desc,id desc),'[]'::jsonb)
 into rows_json from (
  select id,streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,created_at,effective_at,before_data,after_data
  from papa_events
  where streamer_id=room_id and (include_global or entity_kind not in ('players','meta'))
  order by created_at desc,id desc limit 51 offset page_number*50
 ) page_rows;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(x order by n) from jsonb_array_elements(rows_json) with ordinality as t(x,n) where n<=50),'[]'::jsonb),'hasMore',jsonb_array_length(rows_json)>50);
end $$;
revoke all on function public.papa_audit_redact(jsonb),public.papa_event_page(text,int,boolean) from public,anon,authenticated;
grant execute on function public.papa_event_page(text,int,boolean) to service_role;
commit;
