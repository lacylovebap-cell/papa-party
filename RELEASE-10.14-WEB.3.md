# 10.14-WEB.3

- Own-songbook favorite counts use the existing active favorite records, one batch per visible page, 60-second in-memory caching. Names are loaded on click with 20-row pagination and existing manager scope checks.
- Existing player-center medal tab gains a 3/4/5–6 column atlas, filters, protected detail dialogs, own-room switching, searchable Room and global public rankings. No award rules or business writes changed.
- Global ranking groups the verified Account identity and counts each Room/code once across periods. Historical acquisitions remain separate from current eligibility. Fully hidden medals, private profile fields and locked progress are excluded from public responses.
- Existing records without award acquisition rows are not backfilled or assigned invented dates. Public rankings currently have no recorded production awards; current-player eligibility still reads the existing rules.
- Previous WEB.2 layout, page totals and six version categories remain included. Audit totals prefer existing narrow indexes. Streamer context now passes the verified canonical Room identifier to scoped medal/message queries.

Validation: 58 targeted tests passed, including existing award-rule regressions, new PostgreSQL audience/rank projections, Edge actor validation, cache, favorites, pagination and mobile UI checks. Local browser checked mobile 320/390 widths, detail buttons, private/public gallery switching and ranking navigation. Production protected installation verified unchanged business entities, favorites, awards, Audit head, original catalog relationships and accounting guards; original 19:00 rollover retained. Formal readonly RPC and ACL verification passed.

Deployment verification is recorded separately after publication; this document alone is not proof of live release.
