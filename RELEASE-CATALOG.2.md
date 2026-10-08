# 10.08-CATALOG.2

Baseline: 289b9762844e57aef000b9e97d88d958f2572c03.

Integrated catalogue release: independent review tabs and selected subgroup transactions, existing-song links, distinct streamer counts, rich variant metadata, paginated public common book, scoped issue reports, import matching, hidden room songs, shared/custom lyric preservation and on-demand lyric adoption. New-song proxy flow preserves its draft; long modal close controls remain visible.

Validation: full regression 254 tests (253 initially passed; the sole failure was an outdated president-role fixture, repaired and all 5 tests in that file passed). Exact eight-migration deployment bundle passed the SQL integration suite. Frontend build passed. Mobile 390 × 844: no page overflow and close button remains visible after scrolling.

Database recovery point: private papa_release_backups release 10.08-CATALOG.2-before, captured 2026-10-08 06:03:31 UTC; 2339 entity rows plus catalogue data and original helper definitions. Edge rollback source downloaded separately into work/release-1008-rollback.

Deployment order: atomic additive 202610080001–008 with original-entity digest assertion, generated party-api bundle, then fast-forward main / GitHub Pages. No scan, automatic merge, historical rewrite or additional subscription/polling. Rollback UI/Edge to the baseline; additive database objects can remain for backwards compatibility.
