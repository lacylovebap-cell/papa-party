-- LOCAL PROPOSAL ONLY: production execution requires approval.
create or replace function public.papa_platform_directory(subject uuid, search_text text default '', status_filter text default 'all', requested_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare total_rows integer; page_number integer; result_rows jsonb;
begin
 if not exists(select 1 from public.papa_platform_roles p join public.papa_accounts a on a.id=p.account_id where p.account_id=subject and p.role='president' and a.disabled_at is null) then
  raise exception 'PLATFORM_ACCESS_DENIED';
 end if;
 if status_filter is null or status_filter not in ('all','active','suspended') or search_text is null or length(search_text)>100 or requested_page is null or requested_page<1 then raise exception 'PLATFORM_QUERY_INVALID'; end if;
 select count(*) into total_rows from public.papa_spaces s where (status_filter='all' or s.status=status_filter) and (strpos(lower(s.display_name),lower(search_text))>0 or strpos(lower(s.id),lower(search_text))>0);
 page_number:=least(requested_page,greatest(1,(total_rows+19)/20));
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]'::jsonb) into result_rows from (
 select s.id,s.slug,s.display_name,s.status,s.created_at,
 (select count(*) from public.papa_space_streamers x where x.space_id=s.id) as streamer_count,
 (select count(distinct m.account_id) from public.papa_space_memberships m join public.papa_accounts a on a.id=m.account_id where m.space_id=s.id and m.status='active' and m.role in ('space_admin','streamer_admin') and a.disabled_at is null) as manager_count
 from public.papa_spaces s where (status_filter='all' or s.status=status_filter) and (strpos(lower(s.display_name),lower(search_text))>0 or strpos(lower(s.id),lower(search_text))>0)
 order by s.created_at desc,s.id limit 20 offset (page_number-1)*20
 ) r;
 return jsonb_build_object('rows',result_rows,'total',total_rows,'page',page_number,'pages',greatest(1,(total_rows+19)/20));
end;
$$;
revoke all on function public.papa_platform_directory(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.papa_platform_directory(uuid,text,text,integer) to service_role;
