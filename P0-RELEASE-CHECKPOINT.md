# Issue #14 — 10.05-P0

Implementation completed against main `f1cc6e87e438d533429b378699ad1f52b0af305b`.

- Existing queue accounting and reservations retained; acknowledgment and preparation are additional fields. Historical queues with no new flags remain usable. Backfilled completed songs keep their effective times.
- Player requests require host acknowledgment and 0–120 minute preparation. Zero minutes produces a ready notification immediately. Positive deadlines use the existing minute push worker; delivery can be up to one scheduler tick after the deadline. No additional network polling.
- Random selection now fills the existing on-behalf form and preserves the selected player. The historical self-draw backend action remains compatible for old clients; its independent UI was removed.
- Native top-layer tooltips, mobile queue hierarchy, direct status shortcuts, quota indicator, song creation choices, compact single-candidate review and simplified relations are complete.
- General and catalog history read `papa_events`. Production's old global read took 15,531 ms; it lacked a global time index and performed a full count each page. Production after migration: 64.542 ms for the same 50-row read. The indexed bounded read removes that count and retains real errors, privacy redaction and pagination. New song events capture name/artist snapshots.
- Migration `202610050002_p0_queue_audit.sql` applied in one transaction. Recovery snapshot `10.05-P0-before` and Git tag of the same name retained. Production comparison: 2,237 entities; missing 0, changed 0. Scheduler active; anonymous audit access denied.
- Targeted tests: 100 passed. Full regression: 244 passed, 0 failed/skipped. Static build, Edge bundle, migration bundle and diff checks passed.

Only Issue #14 was implemented. No automatic catalog approval, source-song merge, removal of player/business data, or future backlog work.
