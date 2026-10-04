# Shared catalog V1 — 10.04-CATALOG checkpoint

Updated: 2026-10-04 (Asia/Taipei).
Branch: feature/shared-catalog-v1. Integrated source commit: 8a8f618.
Production frontend baseline: 28811065e178dd8069ce0a9e11129f65e5a07792 (9.28-P2).

## Verified deployment status

- The conflict-retry hotfix (5a51595; 202610040001_version_conflict_no_retry.sql) is deployed. PostgREST was indefinitely retrying intentional VERSION_CONFLICT errors marked with SQLSTATE 40001. The hotfix uses non-retryable PT409 and preserves service-only grants and the original function backup.
- Live verification after the hotfix showed CPU 2%, Postgres errors 0 in the last 60 minutes, and no active commit queries. These are observations at verification time.
- Catalog migrations 001–011 and the existing party-api Edge function are now deployed successfully.
- Postmigration verification: revision 2319, existing entities 2214, original rows unchanged, candidates 0 and links 0 before the initial scan. Anonymous review execution and authenticated direct lyric execution were both denied.
- The new frontend is built and ready. Its main push / Pages deployment is still pending. A build or release.json alone is not evidence of frontend deployment.

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
- The complete production candidate backfill and frontend Pages verification remain pending. Do not infer a pending-candidate count of zero after the scan from the pre-scan zero.
- Live private-message / push delivery cannot be claimed solely from mock browser QA. Do not send messages to other people merely to test.

## Next steps

1. Push the tested frontend and root 10.04-CATALOG manifest to main; confirm Pages deployment and the served release.
2. Run bounded resumable candidate reconciliation, record processed / pending counts and verify it preserves original songs and business revision. Never auto-approve.
3. Check live scoped searches and room switching, notification / chat / board / queue regressions, and update the Egress report with observed production results and limitations.
4. Record final deployment commit, scan counts and verification evidence here and in the external handoff. Do not restart completed work or mix unrelated P3 changes.

## Artifact locations

Repo: C:/Users/Administrator/Documents/Codex/2026-10-01/referenced-chatgpt-conversation-this-is-an/work/papa-party
QA/report/images: C:/Users/Administrator/Documents/Codex/2026-09-17/referenced-chatgpt-conversation-this-is-an-4/outputs/
Browser report: catalog-browser-qa.md
Database recovery proof: database-recovered-2026-10-04.png
Egress report: PA-Party-Supabase-Egress-Audit-2026-10-01.md
External handoff: C:/Users/Administrator/Documents/Codex/2026-10-01/referenced-chatgpt-conversation-this-is-an/outputs/PA-Party-Issue-1-handoff.md