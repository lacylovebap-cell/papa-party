# PA Party 9.24-B.1 — Notification roles and audio

Players use the platform's fixed foreground notification sound and retain all per-type reminder preferences. Only the highest administrator can replace the player sound; each management identity can customize its own device sound. The supplied Marsden Rd 2.m4a remains the default.

Management login now distinguishes Super Admin from Streamer Admin. The existing highest-administrator password remains valid under 總管理. The highest administrator enables each streamer's independent password through 主播帳號與密碼. No production streamer password was invented or changed during deployment.

Streamer sessions can access their own songs, credits, queues, statistics and notifications, plus shared player basic identities. Global account edits, other rooms and backup/publish operations are denied by the backend. Super Admin has a separate global notification inbox, showing each originating streamer. Read state, preferences, realtime topics and push subscriptions are separated by role. Empty streamer homepages no longer require legacy migration just because they have no songs.

## Validation

- 50 automated tests pass; static Build and Edge bundle generation pass.
- Deployed API integration verifies role isolation, shared player identities without password/note exposure, cross-room denials, Super Admin notifications from another room, independent read state, and player rejection for sound changes.
- Existing empty streamer homepage returns ready with zero songs.
- Business snapshots immediately before and after the integration suite are identical. QA credentials are restricted to the existing inactive QA room and disabled after browser verification.
- Browser checks cover player audio controls (zero uploads), streamer controls (one local upload), Super Admin account entry and global notification inbox. Foreground audio playback succeeds.
- Real locked-device/background Push delivery is still pending actual device permission and receipt verification. Push infrastructure is deployed; this document does not certify delivery on every phone/browser. Private messaging and badge events remain future releases.

## Deployment and recovery

Apply the additive migration `202609250001_roles_and_notification_scope.sql`, deploy the Edge bundle from `node build-edge.mjs`, and publish `node build.mjs` output. Private account hashes and login-attempt tables are never published to clients.

The stable predecessor is `release/9.24-B` at `0691d0135ecc948ab9a9997e31401f8ecf6efa6e`. A B.1 checkpoint is retained after deployment. For recovery, prefer reverting the faulty frontend change while keeping role authorization in the current backend. A full rollback to B also requires the matching Edge bundle and disabling streamer-login access first; retain the additive history tables and never restore an old business snapshot over newer player records.
