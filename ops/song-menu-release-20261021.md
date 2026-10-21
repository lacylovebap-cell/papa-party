# 10.21-WEB.2 deployment scope

- Weighted song credits and singer live price share the existing Core quote. Half-song default is one performance/0.5 credit; explicit repeat or configured pair is 1 credit.
- Player hidden-song/pair requests are rejected; authorized manual manager selection remains usable and dice excludes hidden songs.
- Single/favorite confirmations reject stale local revisions. Cross-room batches preview authoritative amounts and reject changed confirmed prices before commit. Preview never writes receipts or accounting.
- Compact application menu retains existing actions, uses 44px minimum targets, and closes on external click, Escape, navigation and successful dialog opening.
- 62 targeted automated tests passed. Browser fixtures passed favorite/admin half-repeat-pair selection, stale-price rejection and seven menu widths.
- No migration or production business-data correction. Platform management schema/UI and new hall slash aliases are excluded from this release.
- Official index, styles, login, manifest and push worker unchanged.

Rollback: return web files to commit 865d5cf85e1e37e107e7a42af195dcf1b07c0ccc and redeploy its existing Edge source (production before this release: party-api v54). No data rollback is required. Do not rewrite existing song/queue snapshots.
