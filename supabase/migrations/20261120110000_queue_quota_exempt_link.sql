-- 11.20-LINK.1: 提歌連動到同一個整點小時的存歌＝現點，不佔提歌額度。
-- Mirrors core queueUsesQuota: rows carrying quota_exempt are skipped.
create or replace function public.papa_queue_uses_quota(record_data jsonb)
 returns boolean language sql immutable set search_path to 'public'
as $function$
 select nullif(record_data->>'voided_at','') is null
  and (record_data->'quota_exempt' is null or record_data->'quota_exempt'='null'::jsonb)
  and coalesce(record_data->>'kind'='saved' or
  record_data->>'kind'='live' and record_data->>'status'='completed'
   and record_data->'quota_carried'='true'::jsonb,false);
$function$;
