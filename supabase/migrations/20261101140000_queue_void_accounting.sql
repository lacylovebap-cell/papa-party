-- 11.01-VOID.1: 刪除紀錄 marks a mistaken completed performance with
-- queue.data.voided_at (accounting guards keep its status, player, song and
-- debit). Badges, medals and evidence already skip voided rows; these two
-- functions did not. Exact text edits with assertions; no table, column,
-- index or data change. Every replacement must match exactly once.
do $migration$
declare src text; needle text; addition text;
begin
 -- 1. Daily accounting summary (後台統計): a voided performance and the ledger
 --    rows linked to it (its debit and the correction that returned it) are
 --    not received, stored, reserved or sung.
 src=pg_get_functiondef('public.papa_accounting_summary(text,text,date)'::regprocedure);
 needle='valid_source from rows q where kind=''queue''),';
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'summary: queue boundary';end if;
 src=replace(src,needle,'valid_source from rows q where kind=''queue'' and nullif(q.data->>''voided_at'','''') is null),');
 needle='e.data->>''streamer_id''=requested_room'||chr(13)||chr(10);
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'summary: rows boundary';end if;
 addition=' and not (e.kind=''ledger'' and exists(select 1 from papa_v2_entities v where v.kind=''queue'' and v.space_id=requested_space and v.id=e.data->>''queueId'' and nullif(v.data->>''voided_at'','''') is not null))';
 src=replace(src,needle,'e.data->>''streamer_id''=requested_room'||addition||chr(13)||chr(10));
 execute src;

 -- 2. Legacy achievement eligibility: a voided performance is not a performance.
 src=pg_get_functiondef('public.papa_achievement_eligibility_legacy'::regproc);
 needle='nullif(e.data->>''performance_duplicate_of'','''') is null';
 if (length(src)-length(replace(src,needle,'')))/length(needle)<>1 then raise exception 'eligibility: boundary';end if;
 execute replace(src,needle,needle||' and nullif(e.data->>''voided_at'','''') is null');
end $migration$;
