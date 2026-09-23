# PA Party 9.24-A

Release A adds server-side permanent event history, editable business timestamps, receipt allocation, and player cancellation. Existing entities remain intact.

## Validation

- 35 automated tests, JavaScript syntax checks, static build.
- Browser: three credits split into one live request and two saved credits; player cancellation remains in history.
- Production isolated test room: allocation, backdated completion, time correction, own cancellation, private audit access, cross-room rejection.
- All existing player/song/ledger/queue/crown/card/wish records matched the fresh pre-release backup after verification.

## Deployment

Apply `supabase/migrations/202609240001_release_a.sql`, deploy the updated party-api, then publish frontend. Migration is additive and also captures a server-private snapshot before changing schema. The new commit procedure and event trigger are backward compatible with the prior frontend.

## Recovery

Previous usable source: branch `recovery/pre-9.24-A`, commit `8072f48067ee73b238108465d591114fe6c6840b`. Redeploy those frontend files and its bundled core + party-api if rollback is needed. Keep the additive audit tables and current business data; do not restore a stale full snapshot over newer user activity. Private backups are not included in the repository.

## Next batches

B notifications; C messaging; D songbook/player center; E performance/badges; F cards/logo/visual fixes; G presence/activity and role completion. Previous unfinished requests remain assigned to those batches. High-frequency browsing activity is separate from this release's permanent business event log.
