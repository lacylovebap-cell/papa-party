# Edge Function release files

`party-api-10.28-THEME.<n>.js` / `party-api-10.28-ADMIN.<n>.js` / `party-api-10.29-PRICE.<n>.js` files are the exact party-api bundles for each 10.28 release (ADMIN.1 = THEME.3 plus platform management accounts and safe deletion; ADMIN.2 = ADMIN.1 plus THEME.4–THEME.6: quota divider, opaque dropdowns, themed buttons, decoration motion; ADMIN.4 = ADMIN.2 plus a corrected streamer-login message for streamers in a not-yet-open new Space; CANCEL.1 = ADMIN.4 plus one unified song cancellation with a recorded `cancel_settlement`, an archive-only history operation and two-sided cancel notices)
(`node build-edge.mjs`, then TypeScript types stripped with `bun build --no-bundle`).
It was deployed through the Supabase MCP tool, which takes file contents inline; the
bundle is too large for that, so the deployed function is a two-file entry that
imports this file by its pinned commit URL. Supabase bundles the import at deploy
time (ESZip), so production never fetches GitHub at runtime.

Deployed entry (`index.ts`):

```ts
import './webpush.ts';
import 'https://raw.githubusercontent.com/lacylovebap-cell/papa-party/<commit>/ops/edge-release/party-api-10.28-<THEME|ADMIN>.<n>.js';
```

`webpush.ts`:

```ts
import webpush from 'npm:web-push@3.6.7';
(globalThis as any).__papaPartyWebpush = webpush;
```

Normal CLI deploys (`supabase functions deploy party-api`) keep working as before
and replace this entry with the regular source.

Rollback: redeploy the same two-file entry pointing at the previous pinned release file
(for CANCEL.1 that is `party-api-10.28-ADMIN.4.js` at commit `615dc9e`; for ADMIN.4 that is `party-api-10.28-ADMIN.2.js` at commit `7ca045de2a05e1e071472545684a3b2e97414fb9`; for ADMIN.1 it was `party-api-10.28-THEME.3.js` at commit `68960b1676e2a880406b3d604a6c4f45ed0f22b0`).
The matching database change (`20261028041500_management_accounts_and_deletion.sql`) is additive and
needs no rollback for the Edge to go back; see `ops/management-accounts-rollback-20261028.sql`.

Regenerate a release file: `node build-edge.mjs`, replace the `import webpush from 'npm:web-push@3.6.7';`
line with `const webpush = globalThis.__papaPartyWebpush;`, run `bun build --no-bundle`, prepend the two
comment lines and add `if (!webpush) throw Error("web-push loader missing");` after the webpush line.
This procedure reproduces `party-api-10.28-THEME.3.js` byte for byte.

10.29-PRICE.1 = ADMIN.5 + the shared pricing engine (three-party fees per slot, cheapest legal plan combination, lone half songs refused) + the QUEUE.1 Core waiting texts. Rollback: `party-api-10.28-ADMIN.5.js` at commit `c937c0ade545da5e057173f0e9302fb67a506b10`.

10.29-THEME.1 (another session, commit `901a9f5`) = PRICE.1 + optional gradient presets.

10.29-PRICE.2 = THEME.1 + hall pricing: the room's `papa_space_policies` 'pricing' record is read alongside every
room snapshot (`s.hallPricing`, never stored back) and drives request pricing, guides and crown cards; two
president-only management ops (`platformSpacePricing`, `platformSpacePricingSave`). Needs migration
`20261029100000_space_pricing.sql` (applied before the Edge). Rollback: `party-api-10.29-THEME.1.js` at commit
`901a9f5c109d57b16ad24d494896e3a3b14b9c9f` (v70); that Edge never reads the 'pricing' record.

10.29-SPACE.1 (deployed 2026-10-29 as v72, commit `799b53e`) = PRICE.2 + new Spaces open for operation: visitors and the president resolve a new Space room by name,
the read shortcut serves open Spaces, `portalDirectory` (open Spaces with names and room slugs only), and new-Space
player logins (`spacePlayerLogin`, `spacePlayerCreate`, `spacePlayerAccess`, `spacePlayerLogins`). Needs migrations
`20261029120000_space_activation.sql` and `20261029120100_space_player_logins.sql` (applied before the Edge).
Rollback: `party-api-10.29-PRICE.2.js` at commit `1a8ab1b89dba93dd2da406b194431415a6b97b87` (v71), then
`ops/space-operations-rollback-20261029.sql` if the database part must be withdrawn too.

10.31-KIND.1 = deployed 10.31-PUSH.1 (v76) + the manager queue operation `changeKind` (提歌⇄現點 correction).
Built by replacing only the Core reducer section of `party-api-10.31-PUSH.1.js` with the same section of a fresh
bundle (the only differences are `changeQueueKind` and its `case "changeKind"`), plus the releaseInfo version.
No database change. Rollback: `party-api-10.31-PUSH.1.js` at commit `ccb051bc0da74fad8b63073cf1c9f64b243cfd01` (v76).

10.31-CALL.1 = deployed 10.31-KIND.1 (v77) + the manager queue operation `call` (📣 呼叫玩家, 30 s apart) and the notice
type `call` (主播呼叫). Built like KIND.1: only the Core reducer and notification-rules sections of
`party-api-10.31-KIND.1.js` are replaced with the same sections of a fresh bundle, plus the releaseInfo version.
Needs migration `20261031150000_notice_type_call.sql` (applied before the Edge; rollback `ops/notice-type-call-rollback-20261031.sql`).
Rollback: `party-api-10.31-KIND.1.js` at commit `18f9b9f143f99bde1021d06697269120a4495449` (v77).

10.31-PUSH.2 = deployed 10.31-CALL.1 (v78) with two changes: `pushSubscribe` upserts on `(streamer_id, endpoint, recipient)`
so a streamer and a player of the same room can share one phone; and `deliverPush` accepts a player's job whose
subscription was registered under another room of the same Space (never chosen push preference counts as on for a
player who has a device subscription; an explicit off still wins). Needs migrations
`20261031160000_push_subscription_per_recipient.sql` and `20261031161000_player_push_any_room.sql` first
(rollbacks `ops/push-subscription-per-recipient-rollback-20261031.sql`, `ops/player-push-any-room-rollback-20261031.sql`).
Rollback Edge: `party-api-10.31-CALL.1.js` at commit `df901c83e7c4c3d38f95b76d33123cd454567bf5` (v78).
