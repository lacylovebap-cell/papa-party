-- REVIEW ONLY: explicit production approval required. Schema only, no row restore.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
CREATE OR REPLACE FUNCTION public.papa_event_song_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare source jsonb; song_data jsonb; variant_data record;
begin
 source=coalesce(new.after_data,new.before_data,'{}');
 if new.entity_kind in ('songs','queue','crowns','wishes','request') then
  select data into song_data from papa_v2_entities where kind='songs' and id=coalesce(source->>'songId',source->>'song_id');
  source=source||jsonb_build_object('songSnapshot',jsonb_build_object('title',coalesce(source->>'title',song_data->>'title'),'artist',coalesce(source->>'artist',song_data->>'artist')));
 elsif new.entity_kind='shared_catalog' then
  select title,artist into variant_data from papa_catalog_variants where id::text=source->>'variantId';
  source=source||jsonb_build_object('songSnapshot',jsonb_build_object('title',coalesce(variant_data.title,source->'titles'->>0,source->'details'->>'title'),'artist',variant_data.artist));
 else return new;end if;
 if new.after_data is not null then new.after_data=papa_audit_redact(source);else new.before_data=papa_audit_redact(source);end if;
 return new;
end $function$
;
revoke all on function public.papa_event_song_snapshot() from public,anon,authenticated;
commit;
