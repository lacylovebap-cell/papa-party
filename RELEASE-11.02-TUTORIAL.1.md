# 11.02-TUTORIAL.1

Frontend-only tutorial center foundation. Backend stays 11.02-CARRY.1.

- Player account/management menu: append 📖 操作教學.
- Streamer backend More menu: append the same tutorial center entry.
- Separate dialog preserves current route and unsaved form state.
- Static JSON, role-specific index, per-step WebP images, no tracking or database writes.
- Only published articles are listed by default. All 13 initial articles remain drafts and hidden in normal mode; the current production center shows 教材準備中.
- Draft review remains explicitly labelled inside the existing demo test mode.
- Original help icons remain intact. Crown/theme full-guide links stay absent until the mapped article is published.

No API, database, pricing, permission, queue or balance logic was changed.

Validation: 38 targeted tests pass; 14 local browser checks pass. Two pre-existing queue-ui fixture failures were reproduced against baseline HEAD (missing isAdmin). Full editorial and production article acceptance remains outstanding; see docs/tutorial-center-handoff.md.

Rollback: revert this release commit and the Pages root deployment. No schema or data rollback is required.
