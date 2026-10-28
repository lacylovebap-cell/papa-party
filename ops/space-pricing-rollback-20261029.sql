-- Rollback for 10.29-PRICE.2 database changes. Only needed if the release is
-- withdrawn AND the database objects should go too: the previous Edge (v69,
-- 10.29-PRICE.1) never reads the 'pricing' policy, so redeploying it already
-- restores the old pricing path. Audit rows stay (immutable by design).
-- Run only with the user's explicit approval.
begin;
set local lock_timeout='3s';
-- Keep a copy of every hall pricing record in the result before removing it.
select space_id,revision,updated_at,value from public.papa_space_policies where policy_key='pricing' order by space_id;
delete from public.papa_space_policies where policy_key='pricing';
drop function if exists public.papa_management_space_pricing_save(uuid,uuid,jsonb);
drop function if exists public.papa_management_space_pricing(uuid,text);
notify pgrst,'reload schema';
commit;
-- Rollover hours changed through the editor are not reverted automatically;
-- the Audit rows (action 'space_pricing') hold each earlier value.
