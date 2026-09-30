# Issue #1 local checkpoint — not ready to deploy

Base: main `28811065e178dd8069ce0a9e11129f65e5a07792` (9.28-P2).
Branch: `feature/shared-catalog-v1`. No P3 code included.

## Implemented locally

- `src/catalog-candidates.js`: pure, non-mutating candidate index and comparisons. Width/case/punctuation normalization, conservative orthographic mappings, explicit caller-provided Chinese folds and aliases, language/version differences, title similarity. Suggestions remain pending; no automatic family/variant/link creation.
- Candidate scan bounds comparisons (500 by default, maximum 5000 per page), with a cursor bound to a caller-owned immutable snapshot ID. Integration must include dictionary/configuration version in snapshot identity. Full pairwise scan is O(n²) overall; replace with indexed candidate retrieval before running large production books. No comprehensive Chinese conversion dictionary included yet.
- `publicViewRoom` now projects public song fields through an allowlist, excluding full lyrics and future unknown private fields. Existing full server-side `songSearch` still searches lyrics and returns only ordinary song metadata.
- Tests cover non-mutating scanning, pending-only results, aliases, versions, paginated resumption, malformed cursors, actual bundled API read/search responses for anonymous and player sessions, manager visibility and cross-room rejection.

## Validation

155 tests pass (141 existing + 14 new). `node build.mjs`, `node build-edge.mjs`, and `git diff --check` pass. Edge bundle compilation is included in tests. No migration exists yet; no SQL validation or production write performed.

## Deployment blocked / pending work

Supabase still displays CPU 99%, high CPU affecting performance, Egress 6.17 GB / 5 GB, and approximately 354,562 Postgres errors in its last-hour dashboard. These are dashboard counts, not confirmed failed user actions; root cause is not diagnosed. Respect the resource-stop condition: keep P2 deployed, no live scan or migration.

**Do not deploy this checkpoint by itself.** Player room/home search still uses local `matchesSong`; after redaction it needs a debounced backend query integration to preserve lyric search. Global `songSearch` already matches lyrics on the server. Existing clients/caches and cache-version invalidation must be covered before rollout. No new version label was set.

Next: implement service-only additive schema, transactional audit/review operations, immutable scan snapshots and efficient candidate retrieval, reviewed Chinese conversion/alias dictionaries, president-only UI and bulk reviews, template management, streamer multi-add and language settings, versioned shared/custom/private lyrics, backend room search plus frontend integration. Test data preservation and actual database permissions in isolated QA after resource recovery. Back up the database before production migration (current backup is Git only). Then deploy/verify backend and Pages together; retain historical song IDs and all original business data. Candidate count remains unknown because production scan has not run.

Do not restart completed candidate/privacy helper work; build on these files and tests.

## Schema audit constraints for the next implementation

These are implementation requirements, not a claim that a migration exists.

- Keep `papa_v2_entities` song JSON and existing `songId` authoritative for local songbooks and history. Add separate family, variant and streamer-song link tables. The link primary key is `(streamer_id, song_id)`; do **not** add `UNIQUE(streamer_id, variant_id)` because multiple existing local songs may legitimately link to one shared variant.
- Unlink deletes or deactivates only the link. Never delete or rewrite the original song, tags, private fields, queue, requests, credits or performance history. Project approved common title/artist/language/performer fields at a dedicated read boundary; never pass this enriched projection into generic `entries()` / `commit()`.
- Index each original song with its source hash and revision. Review must transactionally compare current source identity/hash and candidate version and reject stale decisions. First scan creates candidates only. New songs remain immediately usable if candidate creation fails; recover missed candidates through an idempotent reconciliation path rather than rolling back or duplicating the user's song.
- Language and performer masters have stable IDs, editable names/order and active flags. Used values are deactivated, never hard-deleted; renames must not rewrite local business records.
- Store shared lyric revisions separately from streamer lyric selection (`shared`, `copy`, `own`) and private notes. Copy captures an independent body and never changes on shared revision updates. Use dedicated authorized lyric endpoints. Exclude lyric bodies/private notes from generic read, ordinary search results and generic audit payloads. Lyric audit records reference immutable protected revisions for president history/restore, rather than copying bodies into broadly accessible event records. Preserve the explicit manager lyric workflow through those dedicated endpoints.
- All new tables/functions are service-only: enable RLS, revoke anon/authenticated access and revoke function execution from PUBLIC as appropriate. Check authenticated president role server-side before decisions; do not trust a supplied role or streamer identifier. Apply mutation plus audit atomically and test direct database access denial as well as API permission checks.
- Do not append catalog, candidates or lyrics to `TABLES`, `papa_v2_snapshot`, or ordinary read payloads. Use targeted indexed lookups and keyset backfill. The current pure pairwise scanner is a local test helper, **not** the production scan implementation: a per-page bound alone does not remove its O(N²) total work. Implement indexed candidate retrieval before a live backfill.

Required regression cases: duplicate local songs linking to one variant; unlink preserves local JSON/history; approved projection never writes back; stale review fails without partial audit/link changes; candidate-hook failure leaves new song usable; used-template deactivation; copy/own lyric independence; anonymous/player/generic audit payload privacy; cross-streamer denial; idempotent resumable keyset scan without full snapshot reads.
