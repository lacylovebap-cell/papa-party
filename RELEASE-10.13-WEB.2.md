# 10.13-WEB.2 — minimal receipt/queue linkage repair

Receipt withdrawal now cancels unperformed linked queues and reverses their linked legacy returns in the existing atomic RPC. Completed performances cannot be withdrawn/refunded this way. Original rows and Audit remain; repeated requests cannot create extra credits. SQL rejects a partial withdrawal that leaves returns effective.

The home uses centered text: received new songs | stored songs from this show | completed songs. It no longer displays all-player lifetime balances. Refunds and legacy allocations whose source withdrawal is confirmed by Audit do not count as new receipts. Unknown legacy source links remain preserved. A half-song repeated twice remains one completed song; paired different songs remain two. Voided history says 僅保留紀錄; ordinary settlements have no technical preservation label.

The Space stores its rollover hour. Legacy PA Party retains19:00; new Spaces default to00:00. No entity/ledger/queue/event backfill, extra polling, subscriptions or second ledger is introduced.

99 targeted tests passed, including actual isolated PostgreSQL atomic rollback, concurrent revision rejection and linked return reversal. Previous-show credit usage by another player does not consume this show's new stored credits. Web/Edge builds are performed once for this release.

Formal 米雪10/12 evidence reproduces9/8/379: missing-source allocations, repeated registrations, a half-song repeat count and lifetime balance. Two confirmed re-registrations remain pending separate authorization for annotation; financial balances and original performance facts are not changed by this release. No hard-coded5/2/5 is used.
