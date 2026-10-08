# Architecture continuation — 2026-10-08

Base / formal release: `f5925ba73fa6c0a63e7c17ea43d1a01b661632a7`, `10.08-CATALOG.2`.
Branch: `feature/space-foundation-1008`. Existing dirty development checkout remains untouched.

## Completed locally

- Eleven additive migrations: Account/Space/Membership bridge, installation-bound player/manager credentials, verified legacy identity, actor/target audit snapshots, future native delivery contract, atomic refresh/logout/password revocation, notification ownership, reserved policy/entitlement registry, room-only lean reads, durable Web Push authorization, and a guarded operational commit wrapper.
- Web adoption uses the existing password login UI. Supported browsers persist encrypted refresh credentials in IndexedDB with a nonextractable key; identity metadata and the public installation UUID contain no bearer/refresh tokens. Access tokens are kept in memory. Web Locks coordinate tabs. Unsupported browsers retain legacy login. Encryption at rest is **not** an XSS defense; native adapters still require OS secure storage.
- No timer-based credential refresh. Concurrent requests reuse valid access. Offline registration keeps recoverable metadata; refresh/storage failures cannot silently switch identity. Logout revokes the matching device and password change revokes the matching account's devices.
- Existing Web Push uses its original subscription/job stream, with a nullable durable device binding for new subscriptions. Existing subscriptions are preserved. Durable eligibility outlives access expiry and checks account, membership, Space, room, and recipient. Device logout removes only its route/jobs, preserving notification history.
- Existing granted subscriptions rebind once per device/room, without prompts, duplicate subscription creation, or per-access-token rebinds.
- Queue/credit/request/cancellation/wish operations now read only the requested room's lean snapshot. The guarded transaction delegates to the existing business/audit/notification commit, rejects cross-room IDs and all song/profile/global writes, and preserves sparse ordering. Source/private song bodies are never written from a lean snapshot. Song editing, profile editing, backup and unsupported operations retain the full compatibility path. Space 002 remains blocked until those paths and profile isolation are finished.

## Validation

- `space-web-1008-targeted.txt`: **109/109 targeted tests passed**, covering database migrations, current catalog compatibility, login/session isolation, encrypted storage, parallel tabs, network/storage failures, push binding/revocation, notification Realtime/audio, incremental chat, saved credits, queue quotas/cancellation, and core business behavior.
- Subsequent `space-room-1008-targeted.txt`: **81/81 targeted tests passed** after introducing scoped operational writes. This overlaps the earlier run; do not add the counts or call it a full regression.
- Migration integration runs the current deployed catalog stack first, then all eleven foundation migrations; original business JSON, old event identity fields, and approved catalog links remain unchanged.
- An end-to-end Edge fixture verifies one room snapshot plus one existing notification transaction for completion, without a full snapshot or lyric body. A real PostgreSQL fixture runs the original A/B business/audit/notification transaction and verifies cross-room denial, private source preservation, revision conflicts and rollback after a notification insert failure.
- `node --check` passes for changed Web modules. Edge test harness compiles/exercises the updated TypeScript bundle.
- These are local targeted checks. No Phase 7 full regression/build, live foundation migration, or architecture production deployment has happened. Formal main remains the verified catalog release.

## Next work / release barrier

1. Complete non-operational scoped writes and Space routing/profile isolation before lifting the explicit Space 002 barrier. The operational subset is finished locally; it does not make the full multi-Space business path ready.
2. Verify real browser storage/resume/logout and live Push behavior against staging; never rewrite real queue/ledger data for QA.
3. Continue shared core business gaps, then Android FCM/secure storage/signing/download and Windows adapters/installer; iOS remains reserved interfaces only. No native deliverable is complete yet.
4. Measure Egress/request behavior; tests and code inspection do not prove a billing reduction.
5. Follow the existing final release requirement: complete authorized phases, one full regression/build, production backup/preservation checks, migrations/Edge/Web deployment, necessary smoke tests. Do not deploy a partially routed architecture.
