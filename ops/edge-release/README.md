# Edge Function release files

`party-api-10.28-THEME.<n>.js` / `party-api-10.28-ADMIN.<n>.js` files are the exact party-api bundles for each 10.28 release (ADMIN.1 = THEME.3 plus platform management accounts and safe deletion; ADMIN.2 = ADMIN.1 plus THEME.4–THEME.6: quota divider, opaque dropdowns, themed buttons, decoration motion)
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
(for ADMIN.1 that is `party-api-10.28-THEME.3.js` at commit `68960b1676e2a880406b3d604a6c4f45ed0f22b0`).
The matching database change (`20261028041500_management_accounts_and_deletion.sql`) is additive and
needs no rollback for the Edge to go back; see `ops/management-accounts-rollback-20261028.sql`.

Regenerate a release file: `node build-edge.mjs`, replace the `import webpush from 'npm:web-push@3.6.7';`
line with `const webpush = globalThis.__papaPartyWebpush;`, run `bun build --no-bundle`, prepend the two
comment lines and add `if (!webpush) throw Error("web-push loader missing");` after the webpush line.
This procedure reproduces `party-api-10.28-THEME.3.js` byte for byte.
