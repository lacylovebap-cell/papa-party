begin;
-- Additive, transactionally captured recovery point. Business entities are not rewritten.
create table if not exists public.papa_release_backups (
 release text primary key, captured_at timestamptz not null default now(), snapshot jsonb not null
);
alter table public.papa_release_backups enable row level security;
revoke all on public.papa_release_backups from anon,authenticated;
grant select,insert on public.papa_release_backups to service_role;
insert into public.papa_release_backups(release,snapshot)
values('9.24-A-before',public.papa_v2_snapshot()) on conflict do nothing;

create table if not exists public.papa_events (
 id bigint generated always as identity primary key,
 streamer_id text not null, entity_kind text not null, entity_id text not null,
 action text not null, actor_role text, actor_player_id text,
 created_at timestamptz not null default now(), effective_at text,
 before_data jsonb, after_data jsonb
);
alter table public.papa_events enable row level security;
revoke all on public.papa_events from anon,authenticated;
grant select,insert on public.papa_events to service_role;
grant usage,select on sequence public.papa_events_id_seq to service_role;
create index if not exists papa_events_room_date on public.papa_events(streamer_id,created_at desc,id desc);

-- Never copy authentication values into the audit stream.
create or replace function public.papa_audit_redact(value jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare result jsonb; k text; v jsonb;
begin
 if jsonb_typeof(value)='object' then
  result='{}';
  for k,v in select * from jsonb_each(value) loop
   if k !~* '(password|token|secret|key)' then result=result||jsonb_build_object(k,papa_audit_redact(v)); end if;
  end loop;
  return result;
 elsif jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(papa_audit_redact(x)),'[]') into result from jsonb_array_elements(value) x;
  return result;
 end if;
 return value;
end $$;

create or replace function public.papa_capture_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare ctx jsonb; before_value jsonb; after_value jsonb; row_value jsonb;
begin
 ctx=coalesce(nullif(current_setting('papa.actor_context',true),''),'{}')::jsonb;
 if TG_OP <> 'INSERT' then before_value=OLD.data; end if;
 if TG_OP <> 'DELETE' then after_value=NEW.data; end if;
 if TG_OP='UPDATE' and before_value=after_value then return NEW; end if;
 row_value=coalesce(after_value,before_value);
 insert into papa_events(streamer_id,entity_kind,entity_id,action,actor_role,actor_player_id,effective_at,before_data,after_data)
 values(coalesce(row_value->>'streamer_id',ctx->>'streamer_id','platform'),coalesce(NEW.kind,OLD.kind),coalesce(NEW.id,OLD.id),
 coalesce(ctx->>'action',lower(TG_OP)),coalesce(ctx->>'role','legacy-server'),ctx->>'player_id',
 coalesce(row_value->>'effective_at',row_value->>'completedAt',row_value->>'at'),papa_audit_redact(before_value),papa_audit_redact(after_value));
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
drop trigger if exists papa_entity_event on public.papa_v2_entities;
create trigger papa_entity_event after insert or update or delete on public.papa_v2_entities
for each row execute function public.papa_capture_event();

create or replace function public.papa_release_a_commit(expected bigint,changes jsonb,removed jsonb,actor_context jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
begin
 perform set_config('papa.actor_context',actor_context::text,true);
 return papa_v2_commit(expected,changes,removed);
end $$;
revoke all on function public.papa_release_a_commit(bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.papa_release_a_commit(bigint,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.papa_audit_redact(jsonb),public.papa_capture_event() from public,anon,authenticated;
commit;
