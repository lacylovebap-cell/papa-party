create or replace function public.papa_queue_uses_quota(record_data jsonb)
 returns boolean language sql immutable set search_path to 'public'
as $function$
 select nullif(record_data->>'voided_at','') is null and coalesce(record_data->>'kind'='saved' or
  record_data->>'kind'='live' and record_data->>'status'='completed'
   and record_data->'quota_carried'='true'::jsonb,false);
$function$;
