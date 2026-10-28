-- 最舊 must list records that predate date tracking (no created date) first.
-- Applied to production 2026-10-28 as migration "list_sort_oldest_includes_undated".
-- Only the 'oldest' ORDER BY clauses change: "asc nulls last" -> "asc nulls first"
-- (verified beforehand: every "asc nulls last" in these five functions is an
-- 'oldest' clause). The songbook also orders undated songs by song order.
-- Rollback: ops/list-sort-rollback-20261028.sql
do $$
declare f regprocedure; def text;
begin
 foreach f in array array[
  'public.papa_song_search_room_v4(text,text,text[],integer,integer,text,text,text,text,text,text)'::regprocedure,
  'public.papa_player_management_page_v3(text,text,text,text,integer,integer,boolean,text)'::regprocedure,
  'public.papa_catalog_search_filtered_v2(text,integer,integer,text,text,text,text,text,text,text,text,text)'::regprocedure,
  'public.papa_catalog_public_page_filtered_v2_in_space(text,text,text,text,integer,integer,text,text,text)'::regprocedure,
  'public.papa_player_queue_page(text,jsonb,text,integer,integer)'::regprocedure]
 loop
  def=pg_get_functiondef(f);
  def=regexp_replace(def,'(\s)asc(\s+)nulls(\s+)last','\1asc\2nulls\3first','g');
  if f='public.papa_song_search_room_v4(text,text,text[],integer,integer,text,text,text,text,text,text)'::regprocedure then
   def=regexp_replace(def,'(case\s+when\s+sort_order\s*=\s*''oldest''\s+then\s+sort_date\s+end\s+asc\s+nulls\s+first)',
    '\1,case when sort_order=''oldest'' then song_order end asc,case when sort_order=''newest'' then song_order end desc','g');
  end if;
  execute def;
 end loop;
end $$;
