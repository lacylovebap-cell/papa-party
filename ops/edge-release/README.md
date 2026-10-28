# Edge Function release files

`party-api-10.28-THEME.<n>.js` files are the exact party-api bundles for each 10.28 theme release (latest: THEME.3)
(`node build-edge.mjs`, then TypeScript types stripped with `bun build --no-bundle`).
It was deployed through the Supabase MCP tool, which takes file contents inline; the
bundle is too large for that, so the deployed function is a two-file entry that
imports this file by its pinned commit URL. Supabase bundles the import at deploy
time (ESZip), so production never fetches GitHub at runtime.

Deployed entry (`index.ts`):

```ts
import './webpush.ts';
import 'https://raw.githubusercontent.com/lacylovebap-cell/papa-party/<commit>/ops/edge-release/party-api-10.28-THEME.1.js';
```

`webpush.ts`:

```ts
import webpush from 'npm:web-push@3.6.7';
(globalThis as any).__papaPartyWebpush = webpush;
```

Normal CLI deploys (`supabase functions deploy party-api`) keep working as before
and replace this entry with the regular source.
