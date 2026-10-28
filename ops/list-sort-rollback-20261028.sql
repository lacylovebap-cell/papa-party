-- Reverses 20261028160000_list_sort_oldest_includes_undated (exact text reversal).
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
  def=replace(def,',case when sort_order=''oldest'' then song_order end asc,case when sort_order=''newest'' then song_order end desc','');
  def=regexp_replace(def,'(\s)asc(\s+)nulls(\s+)first','\1asc\2nulls\3last','g');
  execute def;
 end loop;
end $$;
