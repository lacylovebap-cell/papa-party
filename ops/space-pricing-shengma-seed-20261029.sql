-- 10.29-PRICE.2 (pricing spec batch 2): write 聲瑪's current numbers into its new
-- hall pricing record. Prices do not change: the record holds exactly what the
-- six 聲瑪 streamers use today (verified below), and the Edge prices a request
-- from it identically (tests/pricing-engine.test.js, tests/space-pricing.test.js).
-- Requires migration 20261029100000_space_pricing.sql. Runs through the normal
-- management save, so it leaves one immutable Audit row (action 'space_pricing')
-- under the president Account. Rollback: ops/space-pricing-rollback-20261029.sql.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare changed text;
begin
 if to_regprocedure('public.papa_management_space_pricing_save(uuid,uuid,jsonb)') is null then raise exception 'SPACE_PRICING_MIGRATION_MISSING';end if;
 if exists(select 1 from public.papa_space_policies where space_id='space-001' and policy_key='pricing') then raise exception 'SHENGMA_PRICING_ALREADY_EXISTS';end if;
 if (select accounting_rollover_hour from public.papa_spaces where id='space-001') is distinct from 19 then raise exception 'SHENGMA_ROLLOVER_CHANGED';end if;
 -- Every active 聲瑪 streamer still has the price fields read on 2026-10-29.
 select string_agg(m.streamer_id,', ') into changed
 from public.papa_space_streamers m
 cross join lateral (select data->'streamerSettings'->m.streamer_id v from public.papa_v2_entities where kind='meta' and id='1') s
 where m.space_id='space-001' and m.deleted_at is null
  and md5((s.v->'plans')::text||(s.v->'tiers')::text||coalesce(s.v->>'livePrice','')||coalesce(s.v->>'liveDouble','')||coalesce(s.v->>'crownDouble',''))
   is distinct from '1d6e2d91816cca5346f592fb5f4633a4';
 if changed is not null then raise exception 'SHENGMA_SETTINGS_CHANGED: %',changed;end if;
end $$;
select public.papa_management_space_pricing_save('b778a393-d405-4349-a377-34855fb2cdfe'::uuid,'6b0f2a4e-1c39-4d1a-9e57-29d05c2a1029'::uuid,
 jsonb_build_object('spaceId','space-001','expectedRevision',0,'rolloverHour',19,'pricing',
 '{"v":1,"mode":"double","singleFee":"host","names":{"singer":"歌手","host":"2號位主持","hall":"聲瑪樂團"},"unit":"探鑽","perUnit":{"singer":2990,"host":500,"hall":500},"policy":"auto","plans":[{"id":"plan-1","name":"一般 2 首","units":2,"singer":5555,"host":990,"hall":990,"live":true,"enabled":true},{"id":"plan-2","name":"一般 3 首","units":3,"singer":7299,"host":1399,"hall":1399,"live":true,"enabled":true},{"id":"plan-3","name":"一般 6 首","units":6,"singer":13999,"host":2799,"hall":2799,"live":true,"enabled":true},{"id":"plan-4","name":"🏅 金牌歌單","units":10,"singer":22887,"host":4200,"hall":4200,"live":true,"enabled":true}],"tiers":[{"id":"tier-1","name":"至尊卡","fee":925000,"price":55599,"host":18188,"hall":18188,"months":0,"enabled":true},{"id":"tier-2","name":"黑卡","fee":500000,"price":27999,"host":18188,"hall":18188,"months":3,"enabled":true},{"id":"tier-3","name":"鑽石卡","fee":375000,"price":18188,"host":18188,"hall":18188,"months":1,"enabled":true},{"id":"tier-4","name":"鉑金卡","fee":125000,"price":9999,"host":18188,"hall":18188,"months":1,"enabled":true},{"id":"tier-5","name":"金卡","fee":55599,"price":4200,"host":18188,"hall":18188,"months":1,"enabled":true}]}'::jsonb)) result;
commit;
