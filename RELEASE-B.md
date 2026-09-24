# PA Party 9.24-B — Notifications

Players and the administrator now have a notification center, unread count, per-streamer preferences, independent channels per event type, and reversible mute controls. Notifications show the originating streamer and preserve their history when reminders are muted. The supplied M4A is the default foreground alert; each device can choose its own small audio file.

Requests, approvals, preparation, completion, cancellations, credit changes and qualified hourly failures create recipient-scoped notifications. Business changes and notification inserts commit together. Realtime sends only an opaque invalidation; authenticated API calls retrieve content. Private tables are inaccessible through the public API key.

Opt-in Web Push uses encrypted payloads, session-bound device subscriptions, server-only VAPID keys, persisted delivery jobs, retries and expired-subscription cleanup. The service worker does not cache business data or login credentials. Users enable their device in 訊息 → 通知設定 and can send a notification to themselves. Background sound is controlled by the OS, not the custom foreground audio.

## Verification

- 45 automated tests pass; static Build and Edge bundle syntax checks pass.
- Isolated production QA verifies host/player/room separation, unread isolation, preference persistence, request/approval/ready/cancellation/credit events and Realtime invalidation.
- Anonymous access to all five notification/configuration tables is denied.
- Browser checks verify the test notification, settings, desktop layout and a 390px iframe (375px content viewport, no dialog horizontal overflow). Provided audio decodes to 1.984 seconds without an error.
- Each integration test compares current business records immediately before and after; originals are unchanged. The QA room is inactive and browser QA session revoked. Live user edits since the initial backup are preserved, not rolled back.
- Actual background/locked-device Push delivery remains unverified: the QA browser did not complete notification permission/subscription. The deployed self-test allows each device to confirm delivery. No claim of actual device delivery is made.

## Deploy and recover

Apply additive migrations 202609240003, 0004 and 0005; run `node build-edge.mjs` and deploy its generated Edge bundle, then publish `node build.mjs` output. The stable predecessor is `release/9.24-A.1` at 7b36d78d6c230d1a65a8613df9048575525c7756.

To recover, republish that frontend and its corresponding Edge bundle. Disable the `papa-notification-retry` cron job if reverting the notification backend. Leave additive notification tables/history intact; never restore the old full business snapshot over newer records.

Release C private messages/comments and Release E badges are not implemented by this batch. Their notification preferences are reserved for those future events.
