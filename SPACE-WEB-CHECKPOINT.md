# Architecture continuation — 2026-10-08

Base / formal release: `f5925ba73fa6c0a63e7c17ea43d1a01b661632a7`, `10.08-CATALOG.2`.
Branch: `feature/space-foundation-1008`. Existing dirty development checkout remains untouched.

## Completed locally

- Ten additive migrations: Account/Space/Membership bridge, installation-bound player/manager credentials, verified legacy identity, actor/target audit snapshots, future native delivery contract, atomic refresh/logout/password revocation, notification ownership, reserved policy/entitlement registry, room-only lean reads, durable Web Push authorization.
- Web adoption uses the existing password login UI. Supported browsers persist encrypted refresh credentials in IndexedDB with a nonextractable key; identity metadata and the public installation UUID contain no bearer/refresh tokens. Access tokens are kept in memory. Web Locks coordinate tabs. Unsupported browsers retain legacy login. Encryption at rest is **not** an XSS defense; native adapters still require OS secure storage.
- No timer-based credential refresh. Concurrent requests reuse valid access. Offline registration keeps recoverable metadata; refresh/storage failures cannot silently switch identity. Logout revokes the matching device and password change revokes the matching account's devices.
- Existing Web Push uses its original subscription/job stream, with a nullable durable device binding for new subscriptions. Existing subscriptions are preserved. Durable eligibility outlives access expiry and checks account, membership, Space, room, and recipient. Device logout removes only its route/jobs, preserving notification history.
- Existing granted subscriptions rebind once per device/room, without prompts, duplicate subscription creation, or per-access-token rebinds.

## Validation

- `space-web-1008-targeted.txt`: **109/109 targeted tests passed**, covering database migrations, current catalog compatibility, login/session isolation, encrypted storage, parallel tabs, network/storage failures, push binding/revocation, notification Realtime/audio, incremental chat, saved credits, queue quotas/cancellation, and core business behavior.
- Migration integration runs the current deployed catalog stack first, then all ten foundation migrations; original business JSON, old event identity fields, and approved catalog links remain unchanged.
- `node --check` passes for changed Web modules. Edge test harness compiles/exercises the updated TypeScript bundle.
- These are local targeted checks. No Phase 7 full regression/build, live foundation migration, or architecture production deployment has happened. Formal main remains the verified catalog release.

## Next work / release barrier

1. Implement and test scoped business writes and complete Space routing/profile isolation before lifting the explicit Space 002 barrier. Lean song snapshots cannot be committed as full song bodies: preserve legacy/private fields and local ordering in the transaction.
2. Verify real browser storage/resume/logout and live Push behavior against staging; never rewrite real queue/ledger data for QA.
3. Continue shared core business gaps, then Android FCM/secure storage/signing/download and Windows adapters/installer; iOS remains reserved interfaces only. No native deliverable is complete yet.
4. Measure Egress/request behavior; tests and code inspection do not prove a billing reduction.
5. Follow the existing final release requirement: complete authorized phases, one full regression/build, production backup/preservation checks, migrations/Edge/Web deployment, necessary smoke tests. Do not deploy a partially routed architecture.
