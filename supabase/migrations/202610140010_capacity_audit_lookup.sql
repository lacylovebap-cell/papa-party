-- Authorized for WEB.5 deployment on 2026-10-14. Preserve identical Audit JSON.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
create or replace function public.papa_event_song_snapshot() returns trigger
language plpgsql security definer set search_path=public as $$
declare source jsonb; song_data jsonb; variant_data record;
begin
 source=coalesce(new.after_data,new.before_data,'{}');
 if new.entity_kind in ('songs','queue','crowns','wishes','request') then
  if source->>'title' is null or source->>'artist' is null then
   select data into song_data from papa_v2_entities where kind='songs' and id=coalesce(source->>'songId',source->>'song_id');
  end if;
  source=source||jsonb_build_object('songSnapshot',jsonb_build_object('title',coalesce(source->>'title',song_data->>'title'),'artist',coalesce(source->>'artist',song_data->>'artist')));
 elsif new.entity_kind='shared_catalog' then
  select title,artist into variant_data from papa_catalog_variants where id::text=source->>'variantId';
  source=source||jsonb_build_object('songSnapshot',jsonb_build_object('title',coalesce(variant_data.title,source->'titles'->>0,source->'details'->>'title'),'artist',variant_data.artist));
 else return new;end if;
 if new.after_data is not null then new.after_data=papa_audit_redact(source);else new.before_data=papa_audit_redact(source);end if;
 return new;
end $$;
revoke all on function public.papa_event_song_snapshot() from public,anon,authenticated;
commit;
