-- 11.01-VOID.2: the last DB readers of completed performances that did not
-- skip 刪除紀錄 (queue.data.voided_at). Exact-once text edits; no schema/data.
--  * papa_queue_uses_quota: shared hourly-quota predicate (used by
--    papa_player_streamer_summary and papa_extra_quota_snapshot_metadata),
--    matching core queueUsesQuota.
--  * papa_listening_history_page: 我最常聽的歌 counts.
do $migration$
declare src text; needle text;
begin
 src=pg_get_functiondef('public.papa_queue_uses_quota(jsonb)'::regprocedure);
 needle='select coalesce(';
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'quota: boundary';end if;
 execute replace(src,needle,'select nullif(record_data->>''voided_at'','''') is null and coalesce(');

 src=pg_get_functiondef('public.papa_listening_history_page(text,text,text,jsonb,integer,integer)'::regprocedure);
 needle='and entry.data->>''status''=''completed'' and entry.data->>''kind'' is distinct from ''self''';
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'listening: boundary';end if;
 execute replace(src,needle,needle||' and nullif(entry.data->>''voided_at'','''') is null');
end $migration$;
