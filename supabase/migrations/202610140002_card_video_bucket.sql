begin;
-- New public card submissions only. Existing photo limits, objects and ACLs
-- are untouched. Uploads still pass the existing authenticated manager API.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('papa-card-media','papa-card-media',true,20971520,array['video/mp4','video/webm']) on conflict do nothing;
do $$begin
 if not exists(select 1 from storage.buckets where id='papa-card-media' and public and file_size_limit=20971520
  and allowed_mime_types @> array['video/mp4','video/webm'] and allowed_mime_types <@ array['video/mp4','video/webm'])
 then raise exception 'CARD_MEDIA_BUCKET_CONFIGURATION_INVALID';end if;
end $$;
commit;
