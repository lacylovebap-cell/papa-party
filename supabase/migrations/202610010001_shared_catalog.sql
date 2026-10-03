-- Shared catalog V1. Additive only: papa_v2_entities and historical song IDs stay authoritative.
-- Deploy only after a database backup and isolated QA. Every catalog object is service-only.
begin;

create table public.papa_catalog_languages (
 id text primary key, name text not null unique, sort_order int not null default 0,
 active boolean not null default true, updated_at timestamptz not null default now()
);
create table public.papa_catalog_performer_types (
 id text primary key, name text not null unique, sort_order int not null default 0,
 active boolean not null default true, updated_at timestamptz not null default now()
);
insert into public.papa_catalog_languages(id,name,sort_order) values
 ('mandarin','國語',10),('taiwanese','台語',20),('hakka','客語',30),('cantonese','粵語',40),
 ('english','英語',50),('japanese','日語',60),('korean','韓語',70),('thai','泰語',80),
 ('vietnamese','越南語',90),('indonesian','印尼語',100),('malay','馬來語',110),
 ('spanish','西班牙語',120),('portuguese','葡萄牙語',130),('french','法語',140),
 ('german','德語',150),('italian','義大利語',160),('russian','俄語',170),
 ('ukrainian','烏克蘭語',180),('arabic','阿拉伯語',190),('hindi','印地語',200),
 ('other','其他',999) on conflict do nothing;
insert into public.papa_catalog_performer_types(id,name,sort_order) values
 ('male','男歌手',10),('female','女歌手',20),('duet_mf','男女合唱',30),
 ('duet_mm','男男合唱',40),('duet_ff','女女合唱',50),('band','團體／樂團',60),
 ('ensemble','多人合唱',70),('other','其他',999) on conflict do nothing;

create table public.papa_catalog_families (
 id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 300),
 active boolean not null default true, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.papa_catalog_variants (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.papa_catalog_families(id),
 title text not null check(length(trim(title)) between 1 and 300), artist text not null default '',
 language_id text references public.papa_catalog_languages(id), language_text text not null default '',
 performer_type_id text references public.papa_catalog_performer_types(id), performer_type_text text not null default '',
 version_label text not null default '', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index papa_catalog_variants_family on public.papa_catalog_variants(family_id,id);
create index papa_catalog_variants_title on public.papa_catalog_variants((lower(title)) text_pattern_ops,id);
create table public.papa_catalog_song_links (
 streamer_id text not null, song_id text not null,
 variant_id uuid not null references public.papa_catalog_variants(id),
 source_hash text not null, linked_at timestamptz not null default now(),
 primary key(streamer_id,song_id)
);
-- Multiple local songs may legitimately link to the same shared variant.
create index papa_catalog_links_variant on public.papa_catalog_song_links(variant_id,streamer_id);

create table public.papa_catalog_candidates (
 id uuid primary key default gen_random_uuid(), streamer_id text not null, song_id text not null,
 source_hash text not null, source_revision bigint not null default 0,
 algorithm text not null default 'catalog-candidates-v1',
 title text not null default '', artist text not null default '', language_text text not null default '',
 performer_type_text text not null default '', version_label text not null default '',
 title_key text not null default '', artist_key text not null default '',
 status text not null default 'pending' check(status in ('pending','approved','rejected','removed')),
 reviewed_by text, reviewed_at timestamptz, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(streamer_id,song_id)
);
create index papa_catalog_candidate_feed on public.papa_catalog_candidates(status,updated_at desc,id desc);
create index papa_catalog_candidate_match on public.papa_catalog_candidates(title_key,artist_key,status,id);
create table public.papa_catalog_audit (
 id bigint generated always as identity primary key, actor_id text not null, action text not null,
 candidate_ids uuid[] not null default '{}', family_id uuid, variant_id uuid,
 details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index papa_catalog_audit_feed on public.papa_catalog_audit(created_at desc,id desc);

create table public.papa_catalog_lyric_revisions (
 variant_id uuid not null references public.papa_catalog_variants(id), revision int not null check(revision>0),
 body text not null, active boolean not null default true, actor_id text not null,
 created_at timestamptz not null default now(), primary key(variant_id,revision)
);
create unique index papa_catalog_one_active_lyric on public.papa_catalog_lyric_revisions(variant_id) where active;
create table public.papa_catalog_lyric_selections (
 streamer_id text not null, song_id text not null, variant_id uuid references public.papa_catalog_variants(id),
 mode text not null check(mode in ('shared','copy','own')), body text,
 updated_at timestamptz not null default now(), primary key(streamer_id,song_id),
 check(mode<>'shared' or body is null)
);
create table public.papa_catalog_private_notes (
 streamer_id text not null, song_id text not null, body text not null default '',
 updated_at timestamptz not null default now(), primary key(streamer_id,song_id)
);
create table public.papa_catalog_language_filters (
 streamer_id text primary key, mode text not null default 'auto' check(mode in ('auto','custom')),
 updated_at timestamptz not null default now()
);
create table public.papa_catalog_language_filter_items (
 streamer_id text not null references public.papa_catalog_language_filters(streamer_id) on delete cascade,
 language_id text not null references public.papa_catalog_languages(id), primary key(streamer_id,language_id)
);

-- Direct browser access to catalog metadata, lyric bodies and private notes is denied.
alter table public.papa_catalog_languages enable row level security;
alter table public.papa_catalog_performer_types enable row level security;
alter table public.papa_catalog_families enable row level security;
alter table public.papa_catalog_variants enable row level security;
alter table public.papa_catalog_song_links enable row level security;
alter table public.papa_catalog_candidates enable row level security;
alter table public.papa_catalog_audit enable row level security;
alter table public.papa_catalog_lyric_revisions enable row level security;
alter table public.papa_catalog_lyric_selections enable row level security;
alter table public.papa_catalog_private_notes enable row level security;
alter table public.papa_catalog_language_filters enable row level security;
alter table public.papa_catalog_language_filter_items enable row level security;
revoke all on public.papa_catalog_languages,public.papa_catalog_performer_types,
 public.papa_catalog_families,public.papa_catalog_variants,public.papa_catalog_song_links,
 public.papa_catalog_candidates,public.papa_catalog_audit,public.papa_catalog_lyric_revisions,
 public.papa_catalog_lyric_selections,public.papa_catalog_private_notes,
 public.papa_catalog_language_filters,public.papa_catalog_language_filter_items from public,anon,authenticated;
grant select,insert,update,delete on public.papa_catalog_languages,public.papa_catalog_performer_types,
 public.papa_catalog_families,public.papa_catalog_variants,public.papa_catalog_song_links,
 public.papa_catalog_candidates,public.papa_catalog_audit,public.papa_catalog_lyric_revisions,
 public.papa_catalog_lyric_selections,public.papa_catalog_private_notes,
 public.papa_catalog_language_filters,public.papa_catalog_language_filter_items to service_role;
grant usage,select on sequence public.papa_catalog_audit_id_seq to service_role;

create function public.papa_catalog_normalize(value text) returns text
language sql immutable strict set search_path=public as $$
 select lower(regexp_replace(normalize(value,NFKC),'[[:punct:][:space:]　，。！？、・·]+','','g'))
$$;
create function public.papa_catalog_source_hash(song jsonb) returns text
language sql immutable strict set search_path=public as $$
 select md5(jsonb_build_array(song->>'streamer_id',song->>'songId',song->>'title',song->>'artist',
   song->>'cat',song->>'artistType',song->>'version')::text)
$$;

-- A failed indexing hook cannot roll back a player's newly added song.
create function public.papa_catalog_index_song() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if NEW.kind<>'songs' or coalesce(NEW.data->>'streamer_id','')='' then return NEW; end if;
 begin
  insert into papa_catalog_candidates(streamer_id,song_id,source_hash,source_revision,
   title,artist,language_text,performer_type_text,version_label,title_key,artist_key)
  values(NEW.data->>'streamer_id',NEW.id,papa_catalog_source_hash(NEW.data),
   coalesce((select revision from papa_v2_revision where id=1),0),
   coalesce(NEW.data->>'title',''),coalesce(NEW.data->>'artist',''),
   coalesce(NEW.data->>'cat',''),coalesce(NEW.data->>'artistType',''),
   coalesce(NEW.data->>'version',''),papa_catalog_normalize(coalesce(NEW.data->>'title','')),
   papa_catalog_normalize(coalesce(NEW.data->>'artist','')))
  on conflict(streamer_id,song_id) do update set
   source_hash=excluded.source_hash,source_revision=excluded.source_revision,
   title=excluded.title,artist=excluded.artist,language_text=excluded.language_text,
   performer_type_text=excluded.performer_type_text,version_label=excluded.version_label,
   title_key=excluded.title_key,artist_key=excluded.artist_key,
   status=case when papa_catalog_candidates.source_hash<>excluded.source_hash then 'pending' else papa_catalog_candidates.status end,
   reviewed_by=case when papa_catalog_candidates.source_hash<>excluded.source_hash then null else papa_catalog_candidates.reviewed_by end,
   reviewed_at=case when papa_catalog_candidates.source_hash<>excluded.source_hash then null else papa_catalog_candidates.reviewed_at end,
   updated_at=now()
  where papa_catalog_candidates.source_hash is distinct from excluded.source_hash;
 exception when others then
  -- A bounded, idempotent reconciliation RPC repairs missed candidate rows later.
  null;
 end;
 return NEW;
end $$;

-- A president-only Edge route calls this service-only function after validating the
-- PA Party session. All selected candidates are checked and changed in one transaction.
create function public.papa_catalog_review(decision text,candidate_ids uuid[],target_variant uuid default null,
 target_family uuid default null,version_label text default '',actor_id text default '',
 expected_sources jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c papa_catalog_candidates; source_song jsonb; chosen_variant uuid=target_variant;
 chosen_family uuid=target_family; first_title_key text=null; first_artist_key text=null;
 first_language text=null; first_performer text=null; actual_count int=0; distinct_count int;
 language_key text; performer_key text;
begin
 if coalesce(decision,'') not in ('approve_new','link_variant','create_variant','reject','remove','unlink') or
  coalesce(actor_id,'')='' or candidate_ids is null or cardinality(candidate_ids) not between 1 and 100 or
  array_position(candidate_ids,null) is not null or
  expected_sources is null or jsonb_typeof(expected_sources)<>'object' or
  length(coalesce(version_label,''))>120 then raise exception 'CATALOG_REVIEW_INVALID';end if;
 select count(distinct x) into distinct_count from unnest(candidate_ids) x;
 if distinct_count<>cardinality(candidate_ids) then raise exception 'CATALOG_REVIEW_DUPLICATE';end if;
 -- Follow the same revision -> entity -> candidate order as legacy commits.
 perform 1 from papa_v2_revision where id=1 for update;
 if decision='link_variant' then
  select v.family_id into chosen_family from papa_catalog_variants v
   join papa_catalog_families f on f.id=v.family_id and f.active
   where v.id=target_variant and v.active;
  if chosen_family is null then raise exception 'CATALOG_VARIANT_MISSING';end if;
 elsif decision='create_variant' then
  if not exists(select 1 from papa_catalog_families where id=target_family and active) then
   raise exception 'CATALOG_FAMILY_MISSING';end if;
 end if;
 perform 1 from papa_v2_entities e join papa_catalog_candidates indexed on indexed.song_id=e.id
  where e.kind='songs' and indexed.id=any(candidate_ids) order by e.id for update of e;
 for c in select * from papa_catalog_candidates where id=any(candidate_ids) order by id for update loop
  actual_count=actual_count+1;
  if (expected_sources->>c.id::text) is distinct from c.source_hash then
   raise exception 'CATALOG_SELECTION_STALE';end if;
  select data into source_song from papa_v2_entities where kind='songs' and id=c.song_id;
  if source_song is null or source_song->>'streamer_id'<>c.streamer_id or
   papa_catalog_source_hash(source_song)<>c.source_hash then raise exception 'CATALOG_SOURCE_STALE';end if;
  if decision='unlink' then
   if not exists(select 1 from papa_catalog_song_links
    where streamer_id=c.streamer_id and song_id=c.song_id) then raise exception 'CATALOG_LINK_MISSING';end if;
   -- Detaching a common version must never erase the streamer's chosen lyrics.
   -- Materialize the effective shared body before removing its relationship.
   insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body)
    select c.streamer_id,c.song_id,null,'copy',coalesce(r.body,source_song->>'lyrics','')
    from papa_catalog_song_links sl left join papa_catalog_lyric_revisions r
     on r.variant_id=sl.variant_id and r.active
    where sl.streamer_id=c.streamer_id and sl.song_id=c.song_id
    on conflict(streamer_id,song_id) do update set
     variant_id=null,mode=case when papa_catalog_lyric_selections.mode='shared' then 'copy' else papa_catalog_lyric_selections.mode end,
     body=case when papa_catalog_lyric_selections.mode='shared' then excluded.body else papa_catalog_lyric_selections.body end,
     updated_at=now();
   delete from papa_catalog_song_links where streamer_id=c.streamer_id and song_id=c.song_id;
   update papa_catalog_candidates set status='pending',reviewed_by=actor_id,
    reviewed_at=now(),updated_at=now() where id=c.id;
   continue;
  end if;
  if c.status<>'pending' or c.algorithm<>'catalog-candidates-v1' then
   raise exception 'CATALOG_CANDIDATE_STALE';end if;
  select data into source_song from papa_v2_entities where kind='songs' and id=c.song_id for update;
  if source_song is null or source_song->>'streamer_id'<>c.streamer_id or
   papa_catalog_source_hash(source_song)<>c.source_hash then raise exception 'CATALOG_SOURCE_STALE';end if;
  if decision in ('approve_new','create_variant') then
   if first_title_key is null or decision='approve_new' then
    first_title_key=c.title_key;first_artist_key=c.artist_key;
    first_language=c.language_text;first_performer=c.performer_type_text;
    if decision='approve_new' then
     insert into papa_catalog_families(title) values(c.title) returning id into chosen_family;
    end if;
    select id into language_key from papa_catalog_languages
     where name=case when c.language_text='華語' then '國語' else c.language_text end and active;
    select id into performer_key from papa_catalog_performer_types
     where name=c.performer_type_text and active;
    insert into papa_catalog_variants(family_id,title,artist,language_id,language_text,
     performer_type_id,performer_type_text,version_label)
    values(chosen_family,c.title,c.artist,language_key,c.language_text,performer_key,
     c.performer_type_text,coalesce(version_label,'')) returning id into chosen_variant;
   elsif c.title_key<>first_title_key or c.artist_key<>first_artist_key or
    c.language_text<>first_language or c.performer_type_text<>first_performer then
    raise exception 'CATALOG_BATCH_DIFFERENT_VERSIONS';
   end if;
  end if;
  if decision in ('approve_new','link_variant','create_variant') then
   if exists(select 1 from papa_catalog_song_links where streamer_id=c.streamer_id and song_id=c.song_id) then
    raise exception 'CATALOG_ALREADY_LINKED';end if;
   insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash)
    values(c.streamer_id,c.song_id,chosen_variant,c.source_hash);
   -- Approval adds a relation; it must not silently replace existing local lyrics.
   insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body)
    values(c.streamer_id,c.song_id,chosen_variant,
     case when coalesce(source_song->>'lyrics','')<>'' then 'own' else 'shared' end,
     nullif(source_song->>'lyrics',''))
    on conflict(streamer_id,song_id) do nothing;
   update papa_catalog_candidates set status='approved',reviewed_by=actor_id,
    reviewed_at=now(),updated_at=now() where id=c.id;
  else
   update papa_catalog_candidates set status=case when decision='reject' then 'rejected' else 'removed' end,
    reviewed_by=actor_id,reviewed_at=now(),updated_at=now() where id=c.id;
  end if;
 end loop;
 if actual_count<>cardinality(candidate_ids) then raise exception 'CATALOG_CANDIDATE_MISSING';end if;
 insert into papa_catalog_audit(actor_id,action,candidate_ids,family_id,variant_id,details)
 values(actor_id,decision,candidate_ids,chosen_family,chosen_variant,
  jsonb_build_object('count',actual_count,'versionLabel',coalesce(version_label,'')));
 update papa_v2_revision set revision=revision+1 where id=1;
 return jsonb_build_object('ok',true,'variantId',chosen_variant,'familyId',chosen_family,'count',actual_count);
end $$;

-- Template changes never hard-delete values already used by a variant.
create function public.papa_catalog_template_change(kind text,action text,template_id text,
 template_name text default null,sort_order int default null,active boolean default null,
 actor_id text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare changed jsonb;
begin
 if coalesce(kind,'') not in ('language','performer_type') or
  coalesce(action,'') not in ('create','update','deactivate','activate')
  or template_id is null or template_id !~ '^[a-z][a-z0-9_-]{0,63}$' or coalesce(actor_id,'')='' or
  (template_name is not null and length(trim(template_name)) not between 1 and 120) or
  (sort_order is not null and (sort_order<0 or sort_order>100000)) then
  raise exception 'CATALOG_TEMPLATE_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 if kind='language' then
  if action='create' then
   if template_name is null then raise exception 'CATALOG_TEMPLATE_NAME';end if;
   insert into papa_catalog_languages(id,name,sort_order,active)
    values(template_id,trim(template_name),coalesce(sort_order,999),coalesce(active,true));
  else
   update papa_catalog_languages set name=coalesce(trim(template_name),name),
    sort_order=coalesce(papa_catalog_template_change.sort_order,papa_catalog_languages.sort_order),
    active=case when action='deactivate' then false when action='activate' then true
     else coalesce(papa_catalog_template_change.active,papa_catalog_languages.active) end,updated_at=now()
    where id=template_id;
   if not found then raise exception 'CATALOG_TEMPLATE_MISSING';end if;
  end if;
  select to_jsonb(t) into changed from papa_catalog_languages t where t.id=template_id;
 else
  if action='create' then
   if template_name is null then raise exception 'CATALOG_TEMPLATE_NAME';end if;
   insert into papa_catalog_performer_types(id,name,sort_order,active)
    values(template_id,trim(template_name),coalesce(sort_order,999),coalesce(active,true));
  else
   update papa_catalog_performer_types set name=coalesce(trim(template_name),name),
    sort_order=coalesce(papa_catalog_template_change.sort_order,papa_catalog_performer_types.sort_order),
    active=case when action='deactivate' then false when action='activate' then true
     else coalesce(papa_catalog_template_change.active,papa_catalog_performer_types.active) end,updated_at=now()
    where id=template_id;
   if not found then raise exception 'CATALOG_TEMPLATE_MISSING';end if;
  end if;
  select to_jsonb(t) into changed from papa_catalog_performer_types t where t.id=template_id;
 end if;
 insert into papa_catalog_audit(actor_id,action,details) values(actor_id,'template_'||action,
  jsonb_build_object('kind',kind,'templateId',template_id,'name',changed->>'name',
   'active',changed->'active'));
 update papa_v2_revision set revision=revision+1 where id=1;
 return changed;
end $$;

-- Protected lyric endpoints are called only after the Edge route checks the
-- president/streamer session. Ordinary read/search/audit never include bodies.
create function public.papa_catalog_save_lyric(variant_id uuid,body text,actor_id text,
 active boolean default true) returns jsonb
language plpgsql security definer set search_path=public as $$
declare vid uuid=variant_id; rev int;
begin
 if vid is null or coalesce(actor_id,'')='' or body is null or length(body)>200000 then
  raise exception 'CATALOG_LYRIC_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 perform 1 from papa_catalog_variants where id=vid and papa_catalog_variants.active for update;
 if not found then raise exception 'CATALOG_VARIANT_MISSING';end if;
 select coalesce(max(r.revision),0)+1 into rev from papa_catalog_lyric_revisions r where r.variant_id=vid;
 update papa_catalog_lyric_revisions r set active=false where r.variant_id=vid and r.active;
 insert into papa_catalog_lyric_revisions(variant_id,revision,body,active,actor_id)
  values(vid,rev,body,coalesce(active,true),actor_id);
 insert into papa_catalog_audit(actor_id,action,variant_id,details) values(actor_id,'lyric_revision',vid,
  jsonb_build_object('revision',rev,'active',coalesce(active,true)));
 update papa_v2_revision set revision=revision+1 where id=1;
 return jsonb_build_object('variantId',vid,'revision',rev,'active',coalesce(active,true));
end $$;

create function public.papa_catalog_lyric_history(variant_id uuid,page_limit int default 20,
 page_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare n int; rows_json jsonb;
begin
 if variant_id is null or page_limit is null or page_offset is null or
  page_limit<1 or page_limit>50 or page_offset<0 or page_offset>10000 then
  raise exception 'CATALOG_PAGE_LIMIT';end if;
 select count(*) into n from papa_catalog_lyric_revisions r where r.variant_id=papa_catalog_lyric_history.variant_id;
 select coalesce(jsonb_agg(to_jsonb(page_rows)),'[]'::jsonb) into rows_json from (
  select revision,body,active,actor_id as "actorId",created_at as "createdAt"
  from papa_catalog_lyric_revisions r where r.variant_id=papa_catalog_lyric_history.variant_id
  order by revision desc limit page_limit offset page_offset
 ) page_rows;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

create function public.papa_catalog_get_lyrics(variant_id uuid default null,room_id text default null,
 song_id text default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare vid uuid=variant_id; selection papa_catalog_lyric_selections; own_note text='';
 source_song jsonb; lyric_body text; rev int; selected_mode text;
begin
 if coalesce(room_id,'')<>'' and coalesce(song_id,'')<>'' then
  select data into source_song from papa_v2_entities where kind='songs' and id=song_id
   and data->>'streamer_id'=room_id;
  if source_song is null then raise exception 'CATALOG_SONG_MISSING';end if;
  select sl.variant_id into vid from papa_catalog_song_links sl
   where sl.streamer_id=room_id and sl.song_id=papa_catalog_get_lyrics.song_id;
  select * into selection from papa_catalog_lyric_selections s
   where s.streamer_id=room_id and s.song_id=papa_catalog_get_lyrics.song_id;
  select n.body into own_note from papa_catalog_private_notes n
   where n.streamer_id=room_id and n.song_id=papa_catalog_get_lyrics.song_id;
  if selection.mode in ('copy','own') then
   return jsonb_build_object('body',selection.body,'revision',null,'mode',selection.mode,
    'privateNote',coalesce(own_note,''),'variantId',vid);
  end if;
  if vid is null then
   return jsonb_build_object('body',coalesce(source_song->>'lyrics',''),'revision',null,
    'mode','own','privateNote',coalesce(own_note,''),'variantId',null);
  end if;
  selected_mode='shared';
 elsif vid is null then
  raise exception 'CATALOG_LYRIC_INVALID';
 end if;
 select r.body,r.revision into lyric_body,rev from papa_catalog_lyric_revisions r
  where r.variant_id=vid and r.active;
 return jsonb_build_object('body',coalesce(lyric_body,''),'revision',rev,
  'mode',coalesce(selected_mode,'shared'),'privateNote',coalesce(own_note,''),'variantId',vid);
end $$;

create function public.papa_catalog_lyric_choice(room_id text,song_id text,mode text,
 body text default null,private_note text default null,actor_id text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare vid uuid; source_song jsonb; chosen_body text=body;
begin
 if coalesce(room_id,'')='' or coalesce(song_id,'')='' or
  coalesce(mode,'') not in ('shared','copy','own') or
  coalesce(actor_id,'')='' or length(coalesce(body,''))>200000 or
  length(coalesce(private_note,''))>5000 then raise exception 'CATALOG_LYRIC_INVALID';end if;
 perform 1 from papa_v2_revision where id=1 for update;
 select data into source_song from papa_v2_entities where kind='songs' and id=song_id
  and data->>'streamer_id'=room_id for update;
 if source_song is null then raise exception 'CATALOG_SONG_MISSING';end if;
 select variant_id into vid from papa_catalog_song_links sl
  where sl.streamer_id=room_id and sl.song_id=papa_catalog_lyric_choice.song_id;
 if mode in ('shared','copy') and vid is null then raise exception 'CATALOG_LINK_MISSING';end if;
 if mode='copy' then
  if body is null then
   select r.body into chosen_body from papa_catalog_lyric_revisions r where r.variant_id=vid and r.active;
  end if;
  chosen_body=coalesce(chosen_body,'');
 elsif mode='own' then chosen_body=coalesce(body,'');
 else chosen_body=null;end if;
 insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body)
  values(room_id,song_id,vid,mode,chosen_body)
  on conflict on constraint papa_catalog_lyric_selections_pkey do update set variant_id=excluded.variant_id,
   mode=excluded.mode,body=excluded.body,updated_at=now();
 if private_note is not null then
  insert into papa_catalog_private_notes(streamer_id,song_id,body) values(room_id,song_id,private_note)
   on conflict on constraint papa_catalog_private_notes_pkey do update set body=excluded.body,updated_at=now();
 end if;
 insert into papa_catalog_audit(actor_id,action,variant_id,details)
  values(actor_id,'lyric_choice',vid,jsonb_build_object('streamerId',room_id,'songId',song_id,'mode',mode));
 update papa_v2_revision set revision=revision+1 where id=1;
 return jsonb_build_object('mode',mode,'variantId',vid);
end $$;

-- One RPC creates original room songs, links, lyric choices and revision together.
-- It never copies another streamer's song settings or changes existing song/history rows.
create function public.papa_catalog_batch_add(room_id text,variant_ids uuid[],lyrics_mode text,
 actor_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v record; song_data jsonb; song_key text; added_ids jsonb='[]'::jsonb;
 added int=0; seen int; current_revision bigint; order_pos int; room_exists boolean; copied_body text;
begin
 if coalesce(room_id,'')='' or coalesce(actor_id,'')='' or
  coalesce(lyrics_mode,'') not in ('shared','copy','own') or variant_ids is null or
  cardinality(variant_ids) not between 1 and 100 or array_position(variant_ids,null) is not null then
  raise exception 'CATALOG_BATCH_INVALID';end if;
 select count(distinct x) into seen from unnest(variant_ids) x;
 if seen<>cardinality(variant_ids) then raise exception 'CATALOG_BATCH_DUPLICATE';end if;
 select exists(select 1 from papa_v2_entities m cross join lateral
  jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  where m.kind='meta' and m.id='1' and room->>'id'=room_id
   and coalesce((room->>'active')::boolean,true)) into room_exists;
 if not room_exists then raise exception 'CATALOG_ROOM_MISSING';end if;
 select revision into current_revision from papa_v2_revision where id=1 for update;
 select coalesce(max(case when data->>'_order'~'^[0-9]+$' then (data->>'_order')::int else 0 end),-1)
  into order_pos from papa_v2_entities where kind='songs';
 perform set_config('papa.actor_context',jsonb_build_object('role','catalog-service',
  'streamer_id',room_id,'action','catalog_batch_add','actor_id',actor_id)::text,true);
 for v in select sv.id,sv.title,sv.artist,sv.language_text,sv.performer_type_text,
   l.name as language_name,p.name as performer_name
  from papa_catalog_variants sv join papa_catalog_families f on f.id=sv.family_id and f.active
  left join papa_catalog_languages l on l.id=sv.language_id
  left join papa_catalog_performer_types p on p.id=sv.performer_type_id
  where sv.id=any(variant_ids) and sv.active
  order by array_position(variant_ids,sv.id) loop
  seen=seen-1;
  if exists(select 1 from papa_catalog_song_links sl where sl.streamer_id=room_id and sl.variant_id=v.id) then
   continue;
  end if;
  song_key=gen_random_uuid()::text;order_pos=order_pos+1;
  song_data=jsonb_build_object('songId',song_key,'streamer_id',room_id,'title',v.title,
   'artist',v.artist,'cat',coalesce(v.language_name,nullif(v.language_text,''),'華語'),
   'artistType',coalesce(v.performer_name,nullif(v.performer_type_text,''),'其他'),
   'tags','[]'::jsonb,'new',false,'murmur','','lyrics','',
   'playAdjustment',0,'creditCost',1,'shortMode','repeat','pairSongIds','[]'::jsonb,
   '_order',order_pos);
  insert into papa_v2_entities(kind,id,data) values('songs',song_key,song_data);
  insert into papa_catalog_song_links(streamer_id,song_id,variant_id,source_hash)
   values(room_id,song_key,v.id,papa_catalog_source_hash(song_data));
  if lyrics_mode='copy' then
   select r.body into copied_body from papa_catalog_lyric_revisions r where r.variant_id=v.id and r.active;
  else copied_body=null;end if;
  insert into papa_catalog_lyric_selections(streamer_id,song_id,variant_id,mode,body)
   values(room_id,song_key,v.id,lyrics_mode,
    case when lyrics_mode='shared' then null else coalesce(copied_body,'') end);
  update papa_catalog_candidates set status='approved',reviewed_by=actor_id,
   reviewed_at=now(),updated_at=now() where streamer_id=room_id and song_id=song_key;
  added=added+1;added_ids=added_ids||to_jsonb(song_key);
 end loop;
 if seen<>0 then raise exception 'CATALOG_VARIANT_MISSING';end if;
 if added>0 then
  update papa_v2_revision set revision=current_revision+1 where id=1;
  current_revision=current_revision+1;
  insert into papa_catalog_audit(actor_id,action,details) values(actor_id,'batch_add',
   jsonb_build_object('streamerId',room_id,'variantIds',to_jsonb(variant_ids),
    'songIds',added_ids,'lyricsMode',lyrics_mode,'count',added));
 end if;
 return jsonb_build_object('added',added,'songIds',added_ids,'revision',current_revision);
end $$;




-- Bounded, metadata-only catalog browsing. Lyric bodies and private notes never join this result.
create function public.papa_catalog_search(query_text text default '',page_limit int default 30,
 page_offset int default 0,room_id text default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare q text=lower(trim(coalesce(query_text,''))); n int; rows_json jsonb;
begin
 if page_limit is null or page_offset is null or page_limit<1 or page_limit>50 or
  page_offset<0 or page_offset>10000 or length(q)>120 then
  raise exception 'CATALOG_PAGE_LIMIT';
 end if;
 select count(*) into n from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id
 left join papa_catalog_languages l on l.id=v.language_id
 left join papa_catalog_performer_types p on p.id=v.performer_type_id
 where v.active and f.active and (q='' or position(q in lower(concat_ws(' ',v.title,v.artist,v.version_label,
  coalesce(l.name,v.language_text),coalesce(p.name,v.performer_type_text))))>0);
 select coalesce(jsonb_agg(to_jsonb(page_rows)),'[]'::jsonb) into rows_json from (
  select v.id, v.family_id as "familyId",v.title,v.artist,v.language_id as "languageId",v.updated_at as "updatedAt",
   coalesce(l.name,v.language_text) as language,v.performer_type_id as "performerTypeId",
   coalesce(p.name,v.performer_type_text) as "performerType",v.version_label as "versionLabel",
   case when room_id is null then false else exists(select 1 from papa_catalog_song_links sl
    where sl.streamer_id=room_id and sl.variant_id=v.id) end as "alreadyAdded"
  from papa_catalog_variants v join papa_catalog_families f on f.id=v.family_id
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  where v.active and f.active and (q='' or position(q in lower(concat_ws(' ',v.title,v.artist,v.version_label,
   coalesce(l.name,v.language_text),coalesce(p.name,v.performer_type_text))))>0)
  order by v.title,v.artist,v.id limit page_limit offset page_offset
 ) page_rows;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

-- Display projection only. Callers must never commit these values back into the
-- original song JSON. Unchanged source identity is required to apply a link.
create function public.papa_catalog_song_metadata(room_id text) returns jsonb
language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('songId',e.id,'title',v.title,'artist',v.artist,
  'cat',coalesce(l.name,v.language_text),'artistType',coalesce(p.name,v.performer_type_text),
  'version',v.version_label,'catalogVariantId',v.id) order by e.id),'[]'::jsonb)
 from papa_catalog_song_links sl
 join papa_v2_entities e on e.kind='songs' and e.id=sl.song_id
  and e.data->>'streamer_id'=sl.streamer_id and papa_catalog_source_hash(e.data)=sl.source_hash
 join papa_catalog_variants v on v.id=sl.variant_id and v.active
 join papa_catalog_families f on f.id=v.family_id and f.active
 left join papa_catalog_languages l on l.id=v.language_id
 left join papa_catalog_performer_types p on p.id=v.performer_type_id
 where sl.streamer_id=room_id
$$;

create function public.papa_catalog_review_list(status text default 'pending',page_limit int default 30,
 page_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare n int; rows_json jsonb;
begin
 if coalesce(status,'') not in ('pending','approved','rejected','removed','history') or
  page_limit is null or page_offset is null or page_limit<1 or page_limit>50 or
  page_offset<0 or page_offset>10000 then raise exception 'CATALOG_PAGE_LIMIT';end if;
 if status='history' then
  select count(*) into n from papa_catalog_audit;
  select coalesce(jsonb_agg(to_jsonb(page_rows)),'[]'::jsonb) into rows_json from (
   select id,actor_id as "actorId",action,candidate_ids as "candidateIds",family_id as "familyId",
    variant_id as "variantId",details,created_at as "createdAt"
   from papa_catalog_audit order by created_at desc,id desc limit page_limit offset page_offset
  ) page_rows;
 else
  select count(*) into n from papa_catalog_candidates c where c.status=papa_catalog_review_list.status;
  select coalesce(jsonb_agg(to_jsonb(page_rows)),'[]'::jsonb) into rows_json from (
   select c.id,c.streamer_id as "streamerId",c.song_id as "songId",c.title,c.artist,
    c.language_text as language,c.performer_type_text as "performerType",c.version_label as "versionLabel",
    c.status,c.source_hash as "sourceHash",c.source_revision as "sourceRevision",
    c.created_at as "createdAt",c.updated_at as "updatedAt",sl.variant_id as "variantId",v.updated_at as "variantUpdatedAt"
   from papa_catalog_candidates c left join papa_catalog_song_links sl
    on sl.streamer_id=c.streamer_id and sl.song_id=c.song_id
   left join papa_catalog_variants v on v.id=sl.variant_id
   where c.status=papa_catalog_review_list.status order by c.updated_at desc,c.id desc
   limit page_limit offset page_offset
  ) page_rows;
 end if;
 return jsonb_build_object('rows',rows_json,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

-- Player/anonymous lyric search runs inside the database and returns IDs only.
-- The Edge route validates room visibility and projects ordinary public song fields.
create function public.papa_song_search_room(room_id text,query_text text default '',tags text[] default '{}',
 page_limit int default 30,page_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare words text[]; n int; ids jsonb;
begin
 if coalesce(room_id,'')='' or length(coalesce(query_text,''))>120 or page_limit is null or
  page_offset is null or page_limit<1 or
  page_limit>50 or page_offset<0 or page_offset>10000 or coalesce(array_length(tags,1),0)>30 then
  raise exception 'CATALOG_SEARCH_LIMIT';end if;
 if not exists(select 1 from papa_v2_entities m cross join lateral
  jsonb_array_elements(coalesce(m.data->'streamers','[]'::jsonb)) room
  where m.kind='meta' and m.id='1' and room->>'id'=room_id
   and coalesce((room->>'active')::boolean,true)) then raise exception 'CATALOG_ROOM_MISSING';end if;
 words=regexp_split_to_array(lower(trim(coalesce(query_text,''))),'[[:space:]　]+');
 with matched as materialized (
  select e.id,case when e.data->>'_order'~'^[0-9]{1,9}$' then (e.data->>'_order')::int else 0 end as song_order
  from papa_v2_entities e
  left join papa_catalog_song_links sl on sl.streamer_id=room_id and sl.song_id=e.id
  left join papa_catalog_variants v on v.id=sl.variant_id and v.active
   and sl.source_hash=papa_catalog_source_hash(e.data)
  left join papa_catalog_languages l on l.id=v.language_id
  left join papa_catalog_performer_types p on p.id=v.performer_type_id
  left join papa_catalog_lyric_selections ls on ls.streamer_id=room_id and ls.song_id=e.id
  left join papa_catalog_lyric_revisions lr on lr.variant_id=sl.variant_id and lr.active
  where e.kind='songs' and e.data->>'streamer_id'=room_id
   and (coalesce(array_length(tags,1),0)=0 or exists(select 1
    from jsonb_array_elements_text(coalesce(e.data->'tags','[]'::jsonb)) song_tag
    where song_tag=any(tags)))
   and not exists(select 1 from unnest(words) word where word<>'' and
    position(word in lower(concat_ws(' ',coalesce(v.title,e.data->>'title'),coalesce(v.artist,e.data->>'artist'),
     coalesce(l.name,v.language_text,e.data->>'cat'),coalesce(p.name,v.performer_type_text,e.data->>'artistType'),e.data->>'murmur',e.data->>'tags',
     coalesce(case when ls.mode in ('copy','own') then ls.body
      when sl.variant_id is not null then lr.body end,e.data->>'lyrics',''))))=0)
 )
 select (select count(*) from matched),
  (select coalesce(jsonb_agg(page_rows.id order by page_rows.song_order,page_rows.id),'[]'::jsonb)
   from (select id,song_order from matched order by song_order,id limit page_limit offset page_offset) page_rows)
 into n,ids;
 return jsonb_build_object('songIds',ids,'total',n,'hasMore',page_offset+page_limit<n);
end $$;

create trigger papa_catalog_song_candidate after insert or update on public.papa_v2_entities
 for each row when (NEW.kind='songs') execute function public.papa_catalog_index_song();

create function public.papa_catalog_reconcile_songs(after_song_id text default '',page_limit int default 100)
returns jsonb language plpgsql security definer set search_path=public as $$
declare song_row record; next_id text=null; processed int=0;
begin
 if page_limit is null or page_limit<1 or page_limit>100 then raise exception 'CATALOG_PAGE_LIMIT'; end if;
 for song_row in select id,data from papa_v2_entities
   where kind='songs' and id>coalesce(after_song_id,'') order by id limit page_limit loop
  next_id=song_row.id; processed=processed+1;
  if coalesce(song_row.data->>'streamer_id','')<>'' then
   insert into papa_catalog_candidates(streamer_id,song_id,source_hash,source_revision,
    title,artist,language_text,performer_type_text,version_label,title_key,artist_key)
   values(song_row.data->>'streamer_id',song_row.id,papa_catalog_source_hash(song_row.data),
    coalesce((select revision from papa_v2_revision where id=1),0),
    coalesce(song_row.data->>'title',''),coalesce(song_row.data->>'artist',''),
    coalesce(song_row.data->>'cat',''),coalesce(song_row.data->>'artistType',''),
    coalesce(song_row.data->>'version',''),papa_catalog_normalize(coalesce(song_row.data->>'title','')),
    papa_catalog_normalize(coalesce(song_row.data->>'artist','')))
   on conflict(streamer_id,song_id) do update set
    source_hash=excluded.source_hash,source_revision=excluded.source_revision,
    title=excluded.title,artist=excluded.artist,language_text=excluded.language_text,
    performer_type_text=excluded.performer_type_text,version_label=excluded.version_label,
    title_key=excluded.title_key,artist_key=excluded.artist_key,
    status=case when papa_catalog_candidates.source_hash<>excluded.source_hash then 'pending' else papa_catalog_candidates.status end,
    reviewed_by=case when papa_catalog_candidates.source_hash<>excluded.source_hash then null else papa_catalog_candidates.reviewed_by end,
    reviewed_at=case when papa_catalog_candidates.source_hash<>excluded.source_hash then null else papa_catalog_candidates.reviewed_at end,
    updated_at=now()
   where papa_catalog_candidates.source_hash is distinct from excluded.source_hash;
  end if;
 end loop;
 return jsonb_build_object('processed',processed,'nextCursor',case when processed=page_limit then next_id else null end);
end $$;

revoke all on function public.papa_catalog_normalize(text),public.papa_catalog_source_hash(jsonb),
 public.papa_catalog_index_song(),public.papa_catalog_reconcile_songs(text,int),
 public.papa_catalog_search(text,int,int,text),public.papa_catalog_review_list(text,int,int),
 public.papa_catalog_review(text,uuid[],uuid,uuid,text,text,jsonb),public.papa_catalog_song_metadata(text),
 public.papa_catalog_template_change(text,text,text,text,int,boolean,text),
 public.papa_catalog_save_lyric(uuid,text,text,boolean),public.papa_catalog_lyric_history(uuid,int,int),
 public.papa_catalog_get_lyrics(uuid,text,text),
 public.papa_catalog_lyric_choice(text,text,text,text,text,text),
 public.papa_catalog_batch_add(text,uuid[],text,text),
 public.papa_song_search_room(text,text,text[],int,int) from public,anon,authenticated;
grant execute on function public.papa_catalog_normalize(text),public.papa_catalog_source_hash(jsonb),
 public.papa_catalog_reconcile_songs(text,int),public.papa_catalog_search(text,int,int,text),
 public.papa_catalog_review_list(text,int,int),public.papa_catalog_review(text,uuid[],uuid,uuid,text,text,jsonb),
 public.papa_catalog_song_metadata(text),
 public.papa_catalog_template_change(text,text,text,text,int,boolean,text),
 public.papa_catalog_save_lyric(uuid,text,text,boolean),public.papa_catalog_lyric_history(uuid,int,int),
 public.papa_catalog_get_lyrics(uuid,text,text),
 public.papa_catalog_lyric_choice(text,text,text,text,text,text),
 public.papa_catalog_batch_add(text,uuid[],text,text),
 public.papa_song_search_room(text,text,text[],int,int) to service_role;

commit;

