# Edge function artifacts (generated, not source)

Exact `party-api` bundles produced by `node build-edge.mjs`, kept so that a deploy or a rollback of the
production Edge Function is a tiny stub that imports a pinned commit of one of these files, instead of
re-sending ~340 KB through a deploy tool.

- `party-api/v59-10.27-ADMIN.1.ts`: byte copy of the bundle that was live as party-api v59 (main d8131275).
- `party-api/10.28-ADMIN.1.ts`: bundle built from feature/management-accounts-20261028 (941b5b8).

The source of truth remains `supabase/functions/party-api` and `build-edge.mjs` on the feature branch / main.
