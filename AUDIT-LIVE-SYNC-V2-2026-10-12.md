# Live State Sync and unified message center V2 — Phase 0

Audited latest `origin/main` at `62a025ee56a61afa6f726d3f4e843fe90b5f80c7`, Issue #11 and #17 (both updated 2026-10-07), and the user's 2026-10-12 engineering instruction. The instruction sets synchronization and conflict recovery ahead of UI-only changes. Existing notification navigation/settings work remains on this release line; it is not production completion.

| Requirement | Actual state | Evidence / next work |
| --- | --- | --- |
| Remembered device login and independent player/manager authority | Existing foundation, needs regression | `device-session.js`, `web-device-login.js`, backend verified actor |
| Lightweight revision preflight and room snapshot projection | Partial | Edge read checks global revision, then scoped snapshot and response signatures |
| Automatic stale revision recovery | Missing at baseline | `app.js` raises generic error; `refresh()` exits while busy |
| Preserve input during synchronization | Partial at baseline | Skipping reads protects DOM but drops invalidations; no pending state or resume |
| Actor/Space/Room isolation for delayed read responses | Partial at baseline | Manager response token check exists; player response and read apply are unguarded |
| Scoped revision and business invalidation | Missing | Commits still lock one global revision; Realtime only invalidates recipient notification inboxes |
| Incremental database domain reads | Missing | A changed global revision loads scoped snapshot before calculating response hashes |
| Business operation receipt / deduplication | Missing | Commit can succeed before projection fails; retrying request/accounting is unsafe |
| Persistent notification history and server reads | Existing foundation | Notification tables and recipient topics, per-identity preferences |
| Notification auto-restore | Partial | Rebinds remembered subscriptions; missing subscription self-heal and revoked binding recovery are not complete |
| Notification device disable | Bug at baseline | Server unsubscribe did not prevent later remembered rebind; local per-device/scope opt-out being fixed |
| Targeted notification navigation | Local implementation, not yet released | Queue/ledger use already authorized state; precise old chat/reply lookup remains missing |
| Three-tab unified center and category-independent all-read | Missing integration | Chat, board and notices are separate modules and entry points |
| Role navigation, fixed bell and mobile bottom navigation | Partial | Responsive menu exists; bell/room choice still inside menu |
| Android/Windows native delivery | Missing deliverables | No native app shell, APK or installer in current checkout; PWA is Web only |
| Real-device and cross-device latency / usage acceptance | Missing | Unit/browser results cannot establish delivery or 95th percentile production latency |

## Reproduced roots

1. `app.js` notification callback and fallback read discard updates while a dialog/input is active. There is no retained invalidation to apply after editing.
2. Revision rejection is only human-readable text. Mutations cannot distinguish a definitely rejected commit from a committed operation whose subsequent projection or transport failed.
3. A delayed player read can overwrite another login's state/signatures; a read begun before a mutation can replace a newer mutation state.
4. Every room commit compares `papa_v2_revision.id=1`. An isolated PostgreSQL test demonstrates that a Michelle queue change rejects a Papa queue change at its unchanged room revision.
5. Recipient notification broadcasts do not cover all business changes and are not a room/domain invalidation stream. Increasing polling does not repair that contract.

## Execution order and limits

Phase 1 implements a shared read-only recovery coordinator, context/monotonic checks, deferred render, lifecycle recovery and explicit rejected/unknown write outcomes. It never replays a mutation. Phase 2 adds scoped revision/invalidation and a bounded delta-read contract while preserving old clients and the global transaction safety gate. Business receipt/idempotency needs server transaction proof before any automatic write retry. Phase 3–5 integrates inbox categories, server read state and role navigation. Phase 6–7 requires native adapters, physical devices, usage measurements, regression and final deployment.

Baseline fallback remains a 30-second lightweight revision check until business invalidation coverage exists. This batch does not increase that frequency. Lifecycle checks occur at foreground/online events, coalesced across focus/visibility events. Concurrent triggers share one read and at most one trailing invalidation read. Transient read failure retries are bounded to 3/6/12 seconds, at most three retries, paused while hidden/offline/busy. No mutation retry or background business polling is added.

Expected incremental traffic in Phase 1: one revision read per coalesced foreground/online event and per confirmed conflict; a burst while an existing read is running adds at most one trailing read. Unchanged responses reuse server signatures. Actual response bytes, connection counts, message counts and database Egress still require Phase 7 measurement; no estimate is represented as measured account usage.

Acceptance includes stale and uncertain write outcomes, no duplicate business request, out-of-order reads, logout/account/Space change, open form preservation, busy/offline recovery, bounded retries, independent room revisions, notification read category isolation, and Android/Windows foreground/background/lockscreen physical checks. Until all required acceptance is recorded, this release is not V2 production-complete.
