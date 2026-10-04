# Shared catalog — 10.05-CATALOG.2 checkpoint

Updated: 2026-10-05 (Asia/Taipei). Previous stable source: 8b76042793eca1641ac9f7596734b613c10cb2be.

## Current release: catalog usability A–H

- Manual same-song confirmation reuses one active common version across rooms. Existing versions merge only by an explicit president decision; differing versions can be reviewed separately under one work. Local tags, Key, credit costs, private notes, custom lyrics and performance records stay local.
- President navigation has five sections; pending groups expose three decisions and conflicting common fields require a choice. Different-version groups select one source at a time instead of combining differing singers into one version.
- Review and common search use complete pagers and 10/20/50 page sizes. Page selection and explicit all-filter selection retain metadata across pages. Review/add writes use batches of at most 50; common-song removal is recoverable deactivation, never deletion of a local song.
- Mandarin displays as 華語. Old 國語 search input remains an alias; language template/filter references are merged without deleting historical template evidence.
- Non-obvious actions have hover, keyboard and tap explanations. Tags default closed with a selected summary and label search. The compact queue draw uses the current room's eligible songs and adds a self queue item without player credit, hourly quota, popularity or player notifications.
- Both history views read the same redacted event stream and show readable summaries; technical data stays collapsed and original catalog audit records remain.

## Deployment and preservation evidence

- Applied atomic `202610050001_catalog_usability.sql` on Supabase. Private database recovery point: `10.05-CATALOG.2-before`; frontend recovery source is the stable commit above.
- Before/after: 1709 songs, 2237 entities, 11 approved candidates, 11 links and 9 active shared versions. No automatic approval or merge occurred.
- Compared all 2237 backup entities with live rows: 0 missing, 0 changed non-language song fields, 0 changed other records. Only the requested song language value changed. Anonymous review and authenticated direct event RPC execution remain denied.
- Updated existing `party-api` Edge function successfully. Live read-only API QA: 29/29 passed; current room raw JSON read 111863 bytes, unchanged read 58 bytes. This is raw response size, not a claim about Supabase billing compression or monthly savings.
- Final automated suite: 238/238 passed, zero skips/failures. Frontend Build, Edge/schema bundles and diff checks passed.
- Isolated browser fixture QA passed 43-row cross-page selection, first/last paging, conflicting common-field choices, separate version-source selection, tag selection/search, tap explanation and self queue insertion. Fixture self item has null player, zero credit cost and no ledger entries. At 390px viewport the admin song page had no horizontal overflow.
- Pages verification and final release SHA are recorded in the external release handoff after publication. Notification/chat/push code and existing fallbacks remain; no private message was sent to a real user just to test delivery.

## Earlier deployed V1 evidence

# Shared catalog V1 — 10.04-CATALOG checkpoint

Updated: 2026-10-04 (Asia/Taipei).
Branch: feature/shared-catalog-v1. Integrated source commit: 8a8f618.
Pre-release frontend baseline: 28811065e178dd8069ce0a9e11129f65e5a07792 (9.28-P2).
Deployed frontend commit: 12f0e4edab57569ed10aceca668e16cad62b73fc (10.04-CATALOG).

## Verified deployment status

- The conflict-retry hotfix (5a51595; 202610040001_version_conflict_no_retry.sql) is deployed. PostgREST was indefinitely retrying intentional VERSION_CONFLICT errors marked with SQLSTATE 40001. The hotfix uses non-retryable PT409 and preserves service-only grants and the original function backup.
- Live verification after the hotfix showed CPU 2%, Postgres errors 0 in the last 60 minutes, and no active commit queries. These are observations at verification time.
- Catalog migrations 001–011 and the existing party-api Edge function are now deployed successfully.
- Postmigration verification: revision 2319, existing entities 2214, original rows unchanged, candidates 0 and links 0 before the initial scan. Anonymous review execution and authenticated direct lyric execution were both denied.
- Frontend commit 12f0e4edab57569ed10aceca668e16cad62b73fc is pushed. GitHub Pages run 37183303249 completed successfully. The served release.json and public index both verified 10.04-CATALOG with HTTP 200.
- The authenticated president UI completed reconciliation of 1704 songs, in batches of at most 100. Final catalog counts are 1705 candidates, 1694 pending, 11 approved and 11 links; live user actions occurred during verification. One obsolete candidate remains retained, so total candidates are not identical to the number of songs processed. The scan does not automatically approve candidates.
- Final preservation checks are complete: current revision 2335 and 2216 entity rows, with two new queue rows from live activity. No original entity is missing in any kind; all original 1704 songs remain. Comparisons found only serialization-order (_order) changes in 1334 songs, 247 ledger rows, 129 queue rows and 7 cards, plus one meta.streamerSettings update. No other original song, credit or history content changed. The complete raw hash differs after live user activity; do not claim it still equals the pre-release hash. The immediately postmigration hash comparison was unchanged.

## Recovery points

Private backup papa_release_backups, release 10.04-CATALOG-before:

| Evidence | Value |
|---|---|
| Business revision | 2319 |
| Original entity rows | 2214 |
| All-room songs | 1704 |
| Ordered entity content hash | 6491bcf060a8effe726dfb8491a0bd2b |
| Catalog tables before migration | absent |

The backup includes the original snapshot, entity hash and replaced directory, audit and read helper definitions. The hotfix's original function was saved separately as 10.04-version-conflict-before. Preserve both recovery points. Concurrent legitimate business writes can change the live revision/hash; distinguish them from migration effects.

## Completed functionality

- Additive families, variants, streamer-song links, pending candidates, catalog audit, language / performer templates, lyric revisions, room lyric choices, private notes and language settings. Existing song JSON, songId, balances, queues and histories are not rewritten or automatically merged.
- Links use (streamer_id, song_id), allowing duplicate existing local songs to link to one shared version. Unlink preserves the local song and materializes shared lyrics as a room-owned copy when necessary.
- Service-only tables / RPCs use RLS and revoked public execution. Edge authorization enforces president, streamer and player scopes independently of supplied identifiers.
- Candidate reconciliation uses bounded keyset pages (maximum 100 source songs per call). New-song candidate-hook failures do not break the normal song save. The initial scan only creates pending suggestions; it never approves or merges.
- Review / governance transactions check exact version timestamps and source hashes. Stale decisions fail without partial link or audit changes. Shared read projections are never written back by ordinary local-song updates.
- President UI supports bounded review pages, batch decisions, shared metadata, family grouping, version splitting and history. Indexed normalized-title suggestions return at most three current peers per candidate; uncertain relationships remain manual.
- Language / performer templates have stable IDs. Used values can be deactivated without rewriting history. Streamers can search shared variants and add bounded, idempotent batches; already-added versions are disabled.
- Room language settings support automatic actual-song categories or custom template values. Language filtering is applied before pagination and participates in cache identity.
- Shared lyrics use protected revisions. Restoring content creates a new revision, preserving previous history. Room choices support shared, independent copy and own content; private notes remain separate.
- Authorized on-demand lyric reads validate the current room/source link. Stale links fall back to the original local song. Lists, ordinary search and generic event responses omit full lyric bodies and private notes.
- Player lyric search runs in the backend and returns safe song IDs/results, never snippets or a lyric-hit flag. Private notes are excluded.
- Shared and room searches are bounded / paginated. pg_trgm GIN indexes narrow metadata and eligible lyric sources, then exact effective room, tags, language and lyric-choice rules are rechecked. Literal wildcard characters retain literal meaning.
- Frontend debounce, IME composition, stale-response guards, recoverable errors and filter/page resets are implemented. Search caches include room, view, revision, query, filters and page size.

## Egress changes and measurements

- Targeted catalog, room-search, lyric, event-page and directory operations run before full-state loading. Ordinary database reads remove lyric bodies before DB-to-Edge transfer.
- Tiny revision preflight handles unchanged reads; changed and periodic forced reads retain synchronization.
- Private chat uses a bounded recent initial page and incremental sequence catch-up rather than repeatedly downloading the full conversation. Receipts and catch-up remain, and obsolete timers/subscriptions are stopped on identity/page changes.
- Notification audio uses a small stored content version; unchanged audio is not repeatedly downloaded. Existing unread notices do not repeatedly refresh the app.
- Board / streamer directories use selected fields and limits. New event capture and legacy event responses redact lyric bodies / private notes; old history is not bulk rewritten or deleted.

Comparable public read measurements before and after Edge deployment:

| Read | Before | After |
|---|---:|---:|
| Room read, 504 songs | 204,246 bytes | 111,090 bytes |
| Songs including lyric bodies | 504 | 0 |
| Unchanged read | 1,563 bytes | 58 bytes |

These are raw JSON response sizes, not compressed Supabase billing amounts. The entire original entity JSON measured 1,071,853 bytes. pg_stat_statements showed 75,024 cumulative papa_v2_snapshot calls; this is not an hourly rate. Daily Egress savings still require postdeployment observation, and historic quota usage is not erased.

## Validation

- Full final suite: 234/234 passed, zero failures or skips.
- Exact generated 001–011 deployment SQL was tested as a single transaction with real PostgreSQL behavior through PGlite + pg_trgm. Original song, ledger, queue and revision remain unchanged; no automatic candidates; direct anonymous execution denied.
- Tests cover stale reviews, source preservation, permissions, independent lyric modes, languages, pagination, candidate peers and actual indexed plans with large fixtures.
- Frontend Build, Edge bundle, schema bundle and diff-format checks passed; actual bundled Edge behavior is covered.
- Chrome local-fixture QA passed metadata edits, grouping/splitting, lyric restore, language modes and ordinary streamer permissions. The 390 × 844 mobile book had no horizontal overflow; no console warnings/errors were observed. This browser QA used deterministic local API fixtures, not production integration; its small fixture did not exercise multiple pages.
- Live schema permissions, original-data preservation and anonymous read / unchanged read have now also been verified.

## Deliberate limits

- Realtime remains enabled. Notification fallback remains approximately every 30 seconds; bounded board fallback remains approximately every 8 seconds. Reliability was not sacrificed to remove every request.
- One- or two-character queries without useful trigrams retain a scoped exact fallback. Broad searches and total counts still have a cost.
- Chinese normalization uses conservative format / selected orthographic mappings, not a comprehensive simplified/traditional conversion dictionary. Uncertain links require manual review.
- Production backfill, frontend Pages verification and final preservation checks are complete. Raw-hash equality is not claimed after concurrent user activity; preservation was verified by original-entity and content comparison as detailed above.
- Live private-message / push delivery cannot be claimed solely from mock browser QA. Do not send messages to other people merely to test.

## Next steps

1. Preserve the deployed release and both database recovery points; no remaining deployment or preservation step is pending for this release.
2. Preserve the completed 1704-song scan checkpoint and the verified catalog counts. Continue manual review rather than auto-approving suggestions.
3. Check live scoped searches and room switching, notification / chat / board / queue regressions, and update the Egress report with observed production results and limitations.
4. Record final deployment commit, scan counts and verification evidence here and in the external handoff. Do not restart completed work or mix unrelated P3 changes.

## Artifact locations

Repo: C:/Users/Administrator/Documents/Codex/2026-10-01/referenced-chatgpt-conversation-this-is-an/work/papa-party
QA/report/images: C:/Users/Administrator/Documents/Codex/2026-09-17/referenced-chatgpt-conversation-this-is-an-4/outputs/
Browser report: catalog-browser-qa.md
Database recovery proof: database-recovered-2026-10-04.png
Production scan proof: catalog-production-scan-complete.png
Egress report: PA-Party-Supabase-Egress-Audit-2026-10-01.md
External handoff: C:/Users/Administrator/Documents/Codex/2026-10-01/referenced-chatgpt-conversation-this-is-an/outputs/PA-Party-Issue-1-handoff.md
