# 10.14-WEB.5

Capacity growth and read traffic controls, authorized for deployment on 2026-10-14.

- Preserve sparse ordering on every entity patch, including legacy global commits; JSON object key ordering alone does not create a patch.
- Skip identical entity UPSERT updates while keeping existing revision, transaction, Audit, notification and receipt contracts.
- Coalesce simultaneous catalog metadata reads by Space and streamer; forced reads stay independent and later reads still verify the database signature.
- Preserve complete Audit JSON while skipping song lookups when an event already includes its title and artist.
- Synchronize module cache versions and correct stale preview/notification imports.

Approved database scope is limited to two function replacements:

- `202610140009_capacity_noop_commit.sql`
- `202610140010_capacity_audit_lookup.sql`

Existing business rows and Audit are not rewritten. No VACUUM, REINDEX, deletion, archival, data movement or paid-plan change is included. Schema-only rollback files are saved under `ops/`.

Targeted regression, isolated synthetic capacity experiments and Web/Edge builds passed before deployment. Index savings remain unverified in production; this release controls future growth and does not claim to have reclaimed existing disk space.
