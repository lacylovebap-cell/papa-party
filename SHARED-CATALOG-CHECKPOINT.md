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
